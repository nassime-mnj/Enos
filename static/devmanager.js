"use strict";
// DEV MANAGER : dépôts de l'espace de travail WSL (\\wsl.localhost\Ubuntu\home\nasko) · VS Code distant · zone de dépôt des scripts .sh · terminal Linux à sortie en direct.
// Performance : aucune requête tant que la fenêtre est fermée ; pendant une tâche, UNE requête de suite (offset) + la liste des tâches ;
// le texte des tâches reste côté serveur (plafonné), le navigateur n'affiche que la tâche regardée.
(() => {
  const $ = (id) => document.getElementById(id);
  if (!$("b-dev") || !$("dv")) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (p, o = {}) => {
    const r = await fetch(p, { ...o, headers: { "Content-Type": "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(typeof j.detail === "string" ? j.detail : r.statusText); e.status = r.status; throw e; }
    return j;
  };
  const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b || {}) });
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const ago = (t) => { if (!t) return ""; const s = Date.now() / 1000 - t; return s < 3600 ? Math.max(1, Math.round(s / 60)) + " min" : s < 86400 ? Math.round(s / 3600) + " h" : Math.round(s / 86400) + " j"; };
  const kb = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + " Ko" : n + " o");
  const msg = (kind, text, el = "dv-msg") => {
    $(el).innerHTML = text ? `<div class="gt-msg ${kind}">${kind === "ok" ? "✔" : kind === "bad" ? "✕" : "…"} ${esc(text)}</div>` : "";
  };

  const DEFAULT_CMDS = ["git status -sb", "git log --oneline --graph -15", "git branch -a", "git fetch --all --prune", "ls -la", "df -h .", "npm install", "npm run dev", "pip install -r requirements.txt", "make"];
  const S = { base: "~", repos: [], cur: "", info: null, jobs: [], view: "", off: 0, node: null, ended: false, timer: 0, hist: store.get("enos_dev_hist", []), hi: -1, favs: store.get("enos_dev_favs", []) };

  // ------------------------------------------------------------------ dépôts
  function renderRepos() {
    const q = $("dv-filter").value.trim().toLowerCase();
    const list = S.repos.filter((r) => !q || r.name.toLowerCase().includes(q)).sort((a, b) => (b.ts || 0) - (a.ts || 0) || a.name.localeCompare(b.name));
    const sel = $("dv-select");
    sel.innerHTML = `<option value="">— Mes dépôts (${S.repos.length}) —</option>` + [...S.repos].sort((a, b) => a.name.localeCompare(b.name)).map((r) => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join("");
    sel.value = S.cur;
    $("dv-list").innerHTML = list.map((r) => {
      const sub = r.branch === undefined ? "chargement…" : `${esc(r.branch || "pas de Git")}${r.dirty ? ` · ${r.dirty} modif.` : ""}${r.ts ? " · " + ago(r.ts) : ""}`;
      const dot = r.branch === undefined ? "load" : r.dirty ? "dirty" : "";
      return `<button class="dv-repo${r.name === S.cur ? " on" : ""}" data-n="${esc(r.name)}" role="option"><b>${esc(r.name)}</b><i class="dv-dot ${dot}"></i><small>${sub}</small></button>`;
    }).join("") || `<div class="tm-note">${S.repos.length ? "Aucun résultat." : "Aucun dépôt trouvé : clonez-en un."}</div>`;
  }
  async function loadRepos() {
    try {
      const r = await api("/api/dev/repos");
      const old = new Map(S.repos.map((x) => [x.name, x]));
      S.repos = r.repos.map((x) => ({ ...(old.get(x.name) || {}), ...x }));
      $("dv-count").textContent = `${S.repos.length}`;
      S.base = r.base === "~" ? "~" : r.base; $("dv-sub").textContent = `${r.distro} · ${r.base}`;
      renderRepos();
      const d = await api("/api/dev/repos?full=true");                         // branche / modifications / dernier commit : une seule commande WSL
      S.repos = d.repos; renderRepos();
    } catch (e) { msg("bad", e.message); }
  }

  async function select(name, keepOut) {
    S.cur = name; store.set("enos_dev_last", name); renderRepos();
    $("dv-prompt").textContent = name ? `nasko@${name} $` : "$";
    $("dv-cwd").textContent = name ? `${S.base}/${name}` : S.base;
    if (!name) { $("dv-info").hidden = true; $("dv-empty").hidden = false; $("dv-scripts").hidden = true; $("dv-ide").hidden = true; return; }
    await refreshInfo();
    ideSync();
    if (!keepOut && $("dv-ide").hidden) $("dv-cmd").focus();
  }
  async function refreshInfo() {
    if (!S.cur) return;
    try {
      const i = S.info = await api("/api/dev/repo?name=" + encodeURIComponent(S.cur));
      $("dv-empty").hidden = true; $("dv-info").hidden = false; $("dv-scripts").hidden = false;
      $("dv-name").textContent = i.name; $("dv-path").textContent = i.path || "";
      $("dv-branch").textContent = i.branch ? "⎇ " + i.branch : "pas de Git";
      const d = $("dv-dirty"); d.textContent = i.dirty ? `${i.dirty} modification(s)` : i.branch ? "propre" : ""; d.className = "dv-chip " + (i.dirty ? "warn" : "ok");
      const ab = $("dv-ab"); ab.textContent = i.ahead || i.behind ? `↑${i.ahead || 0} ↓${i.behind || 0}` : ""; ab.className = "dv-chip" + (i.behind ? " warn" : "");
      $("dv-sh").innerHTML = i.scripts.map((s) => `<div class="dv-script"><span title="${esc(s.name)}">${esc(s.name)} <small>${kb(s.size)}</small></span><input type="text" placeholder="args" data-a="${esc(s.name)}" aria-label="Arguments de ${esc(s.name)}"><button class="btn" data-s="${esc(s.name)}" title="Exécuter ${esc(s.name)}">▶</button></div>`).join("");
      const r = S.repos.find((x) => x.name === S.cur); if (r) { r.branch = i.branch; r.dirty = i.dirty; renderRepos(); }
    } catch (e) { msg("bad", e.message); $("dv-info").hidden = true; }
  }

  // ------------------------------------------------------------------ tâches + sortie en direct
  const jobLabel = (j) => (j.kind === "script" ? "▶ " : j.kind === "clone" ? "⬇ " : "$ ") + j.cmd.replace(/^\[ -f .*?; bash "\.\/(.*?)".*$/s, "$1");
  function renderJobs() {
    $("dv-jobs").innerHTML = S.jobs.slice(-8).map((j) => `<button class="dv-job ${j.running ? "run" : j.rc === 0 ? "ok" : "bad"}${j.id === S.view ? " on" : ""}" data-j="${j.id}" role="tab" title="${esc(j.cmd)}"><i></i><span>${esc((j.repo ? j.repo + " · " : "") + jobLabel(j))}</span></button>`).join("");
    const n = S.jobs.filter((j) => j.running).length, b = $("dv-busy");
    b.hidden = !n; b.textContent = n + " tâche" + (n > 1 ? "s" : "") + " en cours";
    const cur = S.jobs.find((j) => j.id === S.view), run = !!(cur && cur.running);
    $("dv-stop").hidden = !run;
  }
  function resetOut(job) {
    const out = $("dv-out"); out.textContent = "";
    const h = document.createElement("span"); h.className = "dv-cmdline"; h.textContent = `${job.repo ? S.base + "/" + job.repo : S.base} $ ${job.kind === "script" ? jobLabel(job).slice(2) : job.cmd}\n`;
    S.node = document.createTextNode(""); out.append(h, S.node); S.off = 0; S.ended = false;
  }
  function addOut(text) {
    if (!text) return;
    const out = $("dv-out"), near = out.scrollHeight - out.scrollTop - out.clientHeight < 60;
    S.node.appendData(text);
    if (S.node.length > 400000) S.node.deleteData(0, S.node.length - 300000);       // DOM plafonné
    if (near) out.scrollTop = out.scrollHeight;
  }
  function endLine(j) {
    if (S.ended) return; S.ended = true;
    const s = document.createElement("span"), secs = ((j.t1 || Date.now() / 1000) - j.t0).toFixed(1);
    const ok = j.rc === 0, stopped = j.stopping || j.rc === 143 || j.rc === 137;
    s.className = "dv-end " + (ok ? "ok" : "bad");
    s.textContent = `${ok ? "✔ terminé" : stopped ? "■ arrêté" : "✕ code " + j.rc} · ${secs} s`;
    $("dv-out").append(s); $("dv-out").scrollTop = $("dv-out").scrollHeight;
  }
  async function view(id) {
    const job = S.jobs.find((j) => j.id === id); if (!job) return;
    S.view = id; resetOut(job); renderJobs(); await pump(true);
  }
  async function pump() {
    if (!S.view) return;
    try {
      const j = await api(`/api/dev/job?id=${S.view}&since=${S.off}`);
      if (j.reset) { S.node.data = ""; }
      addOut(j.text); S.off = j.from + j.text.length;
      if (!j.running) endLine(j);
    } catch (e) { if (e.status === 400) S.view = ""; }
  }
  async function tick() {
    clearTimeout(S.timer);
    try {
      const l = await api("/api/dev/jobs"), was = new Map(S.jobs.map((j) => [j.id, j.running]));
      S.jobs = l.jobs;
      await pump(); renderJobs();
      const done = S.jobs.filter((j) => was.get(j.id) && !j.running);
      for (const j of done) onFinish(j);
    } catch (e) {}
    const running = S.jobs.some((j) => j.running);
    if (running && !$("dv").hidden) S.timer = setTimeout(tick, document.hidden ? 2500 : S.jobs.find((j) => j.id === S.view)?.running ? 350 : 1200);
  }
  function onFinish(j) {
    if (j.kind === "clone" && j.rc === 0) { loadRepos().then(() => { const n = j.cmd.replace(/['"]/g, "").replace(/(\.git)?\/*$/, "").split(/[/:]/).pop(); if (S.repos.some((r) => r.name === n)) select(n, true); }); msg("ok", "Dépôt cloné."); $("dv-url").value = ""; }
    else if (j.repo === S.cur) { refreshInfo(); api("/api/dev/repos?full=true").then((d) => { S.repos = d.repos; renderRepos(); }).catch(() => {}); }
  }
  async function launch(p) {
    msg("", "");
    try {
      const { id } = await p;
      const l = await api("/api/dev/jobs"); S.jobs = l.jobs; await view(id); tick();
      const j = S.jobs.find((x) => x.id === id); if (j && !j.running) onFinish(j);                // commande très courte : déjà finie
    } catch (e) { msg("bad", e.message); }
  }
  const runCmd = (cmd) => {
    cmd = (cmd || "").trim(); if (!cmd) return;
    if (!/^(clear|cls)$/.test(cmd) && !S.cur) return msg("bad", "Choisissez d'abord un dépôt dans « Mes dépôts ».");
    if (/^(clear|cls)$/.test(cmd)) { $("dv-out").textContent = ""; S.node = document.createTextNode(""); $("dv-out").append(S.node); $("dv-cmd").value = ""; return; }
    S.hist = [cmd, ...S.hist.filter((h) => h !== cmd)].slice(0, 100); store.set("enos_dev_hist", S.hist); S.hi = -1;
    $("dv-cmd").value = "";
    launch(post("/api/dev/run", { repo: S.cur, cmd }));
  };

  // ------------------------------------------------------------------ favoris
  function renderChips() {
    const favs = S.favs.map((c, i) => `<button class="fav" data-c="${esc(c)}" title="${esc(c)}">${esc(c.length > 34 ? c.slice(0, 33) + "…" : c)}<em data-x="${i}" title="Retirer">✕</em></button>`).join("");
    $("dv-chips").innerHTML = favs + DEFAULT_CMDS.map((c) => `<button data-c="${esc(c)}">${esc(c)}</button>`).join("");
  }

  // ------------------------------------------------------------------ zone de dépôt .sh : TOUJOURS enregistré dans l'espace de travail WSL (\\wsl.localhost\Ubuntu\home\nasko), jamais dans un dépôt
  async function dropFiles(files, overwrite) {
    const box = "dv-import-msg";
    for (const f of files) {
      if (!/\.sh$/i.test(f.name)) { msg("bad", `« ${f.name} » n'est pas un script .sh.`, box); continue; }
      if (f.size > 1.5 * 1048576) { msg("bad", `« ${f.name} » dépasse 1,5 Mo.`, box); continue; }
      const name = f.name.replace(/[^A-Za-z0-9._-]/g, "_");
      try {
        const r = await post("/api/dev/drop", { name, content: await f.text(), overwrite: !!overwrite });
        $(box).innerHTML = `<div class="gt-msg ok">✔ ${esc(r.name)} enregistré dans <code>${esc(r.path)}</code> (exécutable, fins de ligne LF). <button class="btn sm" id="dv-run-dropped">▶ EXÉCUTER</button></div>`;
        $("dv-run-dropped").onclick = () => launch(post("/api/dev/script", { repo: "", script: r.name, args: "" }));
      } catch (e) {
        if (e.status === 409) {
          $(box).innerHTML = `<div class="gt-msg bad">⚠ ${esc(name)} existe déjà dans l'espace de travail. <button class="btn sm" id="dv-ow">REMPLACER</button></div>`;
          $("dv-ow").onclick = () => dropFiles([f], true);
        } else msg("bad", e.message, box);
      }
    }
  }

  // ------------------------------------------------------------------ branchements
  function open() {
    $("dv").hidden = false; document.body.classList.remove("menu-open");
    $("dv-term").hidden = false; renderChips(); renderJobs();
    api("/api/dev/status").then((s) => { if (!s.wsl) msg("bad", "WSL n'est pas installé sur ce PC."); if (s.workspace) { $("dv-sub").textContent = "WSL · " + s.workspace; $("dv-drop").querySelector("code").textContent = s.workspace; } }).catch(() => {});
    loadRepos().then(() => { const last = S.cur || store.get("enos_dev_last", ""); if (last && S.repos.some((r) => r.name === last)) select(last, true); });
    api("/api/dev/jobs").then((l) => { S.jobs = l.jobs; if (!S.view && S.jobs.length) view(S.jobs[S.jobs.length - 1].id); tick(); }).catch(() => {});
  }
  $("b-dev").onclick = open;
  $("dv-close").onclick = () => { $("dv").hidden = true; clearTimeout(S.timer); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("dv").hidden) { if (hideCtx()) return; if (e.target.closest && e.target.closest("#dv-ide")) return; $("dv-close").click(); } });
  $("dv-refresh").onclick = () => { loadRepos(); refreshInfo(); };
  $("dv-filter").oninput = renderRepos;
  $("dv-select").onchange = (e) => select(e.target.value);
  $("dv-list").onclick = (e) => { const b = e.target.closest(".dv-repo"); if (b) select(b.dataset.n); };
  $("dv-clone").onclick = () => launch(post("/api/dev/clone", { url: $("dv-url").value }));
  $("dv-url").onkeydown = (e) => { if (e.key === "Enter") $("dv-clone").click(); };
  $("dv-open").onclick = async () => {
    if (!S.cur) return; const b = $("dv-open"); b.disabled = true; msg("run", "Ouverture de VS Code…");
    try { const r = await post("/api/dev/open", { repo: S.cur }); msg("ok", `VS Code lancé (WSL) sur ${r.path}`); } catch (e) { msg("bad", e.message); }
    b.disabled = false;
  };
  $("dv-explorer").onclick = async () => { if (!S.cur) return; try { await post("/api/dev/explorer", { repo: S.cur }); } catch (e) { msg("bad", e.message); } };
  $("dv-info").addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) runCmd(b.dataset.q); });
  $("dv-sh").onclick = (e) => {
    const b = e.target.closest("[data-s]"); if (!b) return;
    const a = $("dv-sh").querySelector(`input[data-a="${CSS.escape(b.dataset.s)}"]`);
    launch(post("/api/dev/script", { repo: S.cur, script: b.dataset.s, args: a ? a.value : "" }));
  };
  $("dv-sh").onkeydown = (e) => { if (e.key === "Enter" && e.target.dataset.a) { const b = $("dv-sh").querySelector(`button[data-s="${CSS.escape(e.target.dataset.a)}"]`); if (b) b.click(); } };
  $("dv-import").onclick = () => $("dv-file").click();
  $("dv-file").onchange = (e) => { dropFiles([...e.target.files]); e.target.value = ""; };
  // toute la fenêtre du Dev Manager est une zone de dépôt (sinon WebView2 ouvrirait le fichier lâché à côté de la zone) ; l'éditeur garde ses propres glisser-déposer
  const dz = $("dv"), card = $("dv-drop"), inEditor = (e) => e.target.closest && e.target.closest("#dv-ide");
  ["dragenter", "dragover"].forEach((t) => dz.addEventListener(t, (e) => { if (inEditor(e)) return; e.preventDefault(); card.classList.add("drop"); }));
  dz.addEventListener("dragleave", (e) => { if (!dz.contains(e.relatedTarget)) card.classList.remove("drop"); });
  dz.addEventListener("drop", (e) => { if (inEditor(e)) return; e.preventDefault(); card.classList.remove("drop"); dropFiles([...e.dataTransfer.files]); });
  $("dv-form").onsubmit = (e) => { e.preventDefault(); runCmd($("dv-cmd").value); };
  $("dv-cmd").onkeydown = (e) => {
    if (e.key === "ArrowUp" && S.hist.length) { e.preventDefault(); S.hi = Math.min(S.hi + 1, S.hist.length - 1); $("dv-cmd").value = S.hist[S.hi]; }
    else if (e.key === "ArrowDown") { e.preventDefault(); S.hi = Math.max(S.hi - 1, -1); $("dv-cmd").value = S.hi < 0 ? "" : S.hist[S.hi]; }
    else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); runCmd("clear"); }
    else if (e.key.toLowerCase() === "c" && e.ctrlKey && $("dv-cmd").selectionStart === $("dv-cmd").selectionEnd && stopCur()) e.preventDefault();      // Ctrl+C sans sélection = interrompre la tâche
  };
  $("dv-stop").onclick = () => S.view && post("/api/dev/stop", { id: S.view }).then(tick).catch((e) => msg("bad", e.message));
  $("dv-jobs").onclick = (e) => { const b = e.target.closest("[data-j]"); if (b) view(b.dataset.j); };
  $("dv-clear").onclick = () => runCmd("clear");
  $("dv-copy").onclick = async () => { const t = selText(), ok = await copyText(t || $("dv-out").textContent); msg(ok ? "ok" : "bad", ok ? (t ? "Sélection copiée." : "Sortie copiée.") : "Copie impossible."); };
  $("dv-fav").onclick = () => {
    const c = $("dv-cmd").value.trim(); if (!c) return msg("bad", "Tapez d'abord la commande à enregistrer.");
    if (!S.favs.includes(c)) { S.favs.unshift(c); store.set("enos_dev_favs", S.favs); renderChips(); }
  };
  $("dv-chips").onclick = (e) => {
    const x = e.target.closest("[data-x]");
    if (x) { S.favs.splice(+x.dataset.x, 1); store.set("enos_dev_favs", S.favs); return renderChips(); }
    const b = e.target.closest("[data-c]"); if (b) runCmd(b.dataset.c);
  };

  // ------------------------------------------------------------------ presse-papiers + menu contextuel (terminal)
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
    const ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;opacity:0;top:0;left:0"; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (e) {} ta.remove(); return ok;
  }
  const selText = () => String(window.getSelection() || "");
  let ctxEl = null;
  function hideCtx() { if (!ctxEl) return false; ctxEl.remove(); ctxEl = null; return true; }
  function showCtx(e, items) {
    hideCtx(); e.preventDefault();
    const m = ctxEl = document.createElement("div"); m.className = "dv-ctx";
    items.forEach((it) => {
      if (it === "-") return m.append(document.createElement("hr"));
      const b = document.createElement("button"); b.textContent = it.label; b.disabled = !!it.off;
      b.onclick = () => { hideCtx(); it.run(); }; m.append(b);
    });
    document.body.append(m);
    m.style.left = Math.min(e.clientX, innerWidth - m.offsetWidth - 6) + "px"; m.style.top = Math.min(e.clientY, innerHeight - m.offsetHeight - 6) + "px";
  }
  document.addEventListener("mousedown", (e) => { if (ctxEl && !ctxEl.contains(e.target)) hideCtx(); }, true);
  window.addEventListener("blur", hideCtx);
  function pasteIntoCmd(text) {
    const i = $("dv-cmd"); text = String(text || "").replace(/\r?\n/g, " ").trim(); if (!text) return;
    i.focus(); const a = i.selectionStart == null ? i.value.length : i.selectionStart, b = i.selectionEnd == null ? a : i.selectionEnd;
    i.value = i.value.slice(0, a) + text + i.value.slice(b); i.selectionStart = i.selectionEnd = a + text.length;
  }
  const out = $("dv-out");
  const stopCur = () => { const c = S.jobs.find((j) => j.id === S.view); if (c && c.running) { post("/api/dev/stop", { id: S.view }).then(tick).catch(() => {}); return true; } return false; };
  const selectAllOut = () => { const r = document.createRange(); r.selectNodeContents(out); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); };
  out.addEventListener("contextmenu", (e) => {
    const t = selText();
    showCtx(e, [{ label: "Copier", off: !t, run: () => copyText(t).then((ok) => msg(ok ? "ok" : "bad", ok ? "Sélection copiée." : "Copie impossible.")) },
      { label: "Tout sélectionner", run: selectAllOut },
      { label: "Coller dans la commande", run: () => (navigator.clipboard && navigator.clipboard.readText ? navigator.clipboard.readText().then(pasteIntoCmd).catch(() => { $("dv-cmd").focus(); msg("bad", "Presse-papiers illisible : utilisez Ctrl+V dans la ligne de commande."); }) : $("dv-cmd").focus()) },
      "-", { label: "Copier toute la sortie", run: () => copyText(out.textContent).then((ok) => msg(ok ? "ok" : "bad", ok ? "Sortie copiée." : "Copie impossible.")) },
      { label: "Vider le terminal", run: () => runCmd("clear") },
      { label: "Arrêter la tâche (Ctrl+C)", off: !S.jobs.some((j) => j.id === S.view && j.running), run: stopCur }]);
  });
  out.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "c") { if (!selText()) { e.preventDefault(); stopCur(); } }       // sélection → copie native ; sinon Ctrl+C = interrompre la tâche
    else if ((e.ctrlKey || e.metaKey) && k === "a") { e.preventDefault(); selectAllOut(); }
  });
  out.addEventListener("paste", (e) => { e.preventDefault(); pasteIntoCmd(e.clipboardData && e.clipboardData.getData("text")); });

  // ------------------------------------------------------------------ éditeur intégré : explorateur + CodeMirror (coloration, CRUD dans WSL)
  const IDE = { cm: null, all: {}, ready: null };
  const ist = () => (IDE.all[S.cur] = IDE.all[S.cur] || { files: new Map(), cur: "", dirs: new Map(), sel: "." });
  const imsg = (kind, text) => msg(kind, text, "ide-msg");
  const EXT = {
    c: ["text/x-csrc", "C"], h: ["text/x-csrc", "C"], cpp: ["text/x-c++src", "C++"], cc: ["text/x-c++src", "C++"], cxx: ["text/x-c++src", "C++"], hpp: ["text/x-c++src", "C++"], hh: ["text/x-c++src", "C++"],
    java: ["text/x-java", "Java"], cs: ["text/x-csharp", "C#"], m: ["text/x-objectivec", "Objective-C"], sh: ["shell", "Bash"], bash: ["shell", "Bash"], zsh: ["shell", "Shell"], ksh: ["shell", "Shell"],
    py: ["python", "Python"], js: ["javascript", "JavaScript"], mjs: ["javascript", "JavaScript"], cjs: ["javascript", "JavaScript"], jsx: ["text/jsx", "JSX"], ts: ["text/typescript", "TypeScript"], tsx: ["text/typescript-jsx", "TSX"],
    json: ["application/json", "JSON"], html: ["htmlmixed", "HTML"], htm: ["htmlmixed", "HTML"], css: ["css", "CSS"], scss: ["text/x-scss", "SCSS"], xml: ["xml", "XML"], svg: ["xml", "SVG"], md: ["markdown", "Markdown"], markdown: ["markdown", "Markdown"],
    yml: ["yaml", "YAML"], yaml: ["yaml", "YAML"], sql: ["text/x-sql", "SQL"], go: ["text/x-go", "Go"], rs: ["rust", "Rust"], toml: ["toml", "TOML"], ini: ["properties", "INI"], cfg: ["properties", "Config"], conf: ["properties", "Config"],
    properties: ["properties", "Properties"], env: ["properties", "Env"], diff: ["diff", "Diff"], patch: ["diff", "Diff"], cmake: ["cmake", "CMake"], lua: ["lua", "Lua"], pl: ["perl", "Perl"], rb: ["ruby", "Ruby"], php: ["php", "PHP"], mk: ["makefile", "Makefile"],
  };
  const NAMES = { makefile: ["makefile", "Makefile"], gnumakefile: ["makefile", "Makefile"], dockerfile: ["dockerfile", "Dockerfile"], "cmakelists.txt": ["cmake", "CMake"], ".gitignore": ["properties", "gitignore"], ".dockerignore": ["properties", "dockerignore"],
    ".bashrc": ["shell", "Bash"], ".zshrc": ["shell", "Shell"], ".profile": ["shell", "Shell"], ".bash_profile": ["shell", "Bash"], ".env": ["properties", "Env"], ".gitconfig": ["properties", "Config"] };
  function modeFor(path, text) {
    const name = path.split("/").pop().toLowerCase(), ext = name.includes(".") ? name.split(".").pop() : "";
    if (NAMES[name]) return NAMES[name];
    if (/^makefile/.test(name)) return ["makefile", "Makefile"];
    if (EXT[ext]) return EXT[ext];
    const sb = /^#!.*\b(bash|sh|zsh|dash|ksh|python3?|node|perl|ruby|lua)\b/.exec(text.slice(0, 120));
    if (sb) return /python/.test(sb[1]) ? ["python", "Python"] : sb[1] === "node" ? ["javascript", "JavaScript"] : sb[1] === "perl" ? ["perl", "Perl"] : sb[1] === "ruby" ? ["ruby", "Ruby"] : sb[1] === "lua" ? ["lua", "Lua"] : ["shell", "Bash"];
    return ["text/plain", "Texte"];
  }
  function defineMakefile() {
    if (CodeMirror.modes.makefile) return;
    CodeMirror.defineSimpleMode("makefile", { start: [
      { regex: /#.*/, token: "comment" },
      { regex: /(?:ifeq|ifneq|ifdef|ifndef|else|endif|include|-include|sinclude|define|endef|export|unexport|override|vpath)\b/, token: "keyword", sol: true },
      { regex: /[A-Za-z_][\w.\-]*[ \t]*(?:::=|:=|\?=|\+=|!=|=)/, token: "def", sol: true },
      { regex: /[^\s#=:\t][^:=#]*:(?!=)/, token: "header", sol: true },
      { regex: /\$[({][^)}]*[)}]|\$[@<^?*%+|]/, token: "variable-2" },
      { regex: /"(?:[^\\"]|\\.)*"|'[^']*'/, token: "string" },
      { regex: /(?:^|\s)-{1,2}[A-Za-z][\w-]*/, token: "attribute" },
      { regex: /\b\d+\b/, token: "number" },
      { regex: /[;|&<>]+/, token: "operator" }] });
  }
  function loadCM() {
    if (window.CodeMirror) return Promise.resolve();
    return IDE.ready || (IDE.ready = new Promise((ok, ko) => {
      const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/static/cm_base.css"; document.head.append(l);
      const s = document.createElement("script"); s.src = "/static/vendor/codemirror.bundle.js";
      s.onload = () => { defineMakefile(); ok(); }; s.onerror = () => { IDE.ready = null; ko(new Error("bibliothèque d'édition introuvable")); }; document.head.append(s);
    }));
  }
  function ensureEditor() {
    if (IDE.cm) return;
    const smartTab = (cm) => (cm.somethingSelected() ? cm.indentSelection("add") : cm.getOption("indentWithTabs") ? cm.replaceSelection("\t") : cm.execCommand("insertSoftTab"));
    IDE.cm = CodeMirror($("ide-host"), { value: "", theme: "enos", lineNumbers: true, matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true, indentUnit: 4, tabSize: 4,
      readOnly: "nocursor", extraKeys: { "Ctrl-S": ideSave, "Cmd-S": ideSave, Tab: smartTab, "Shift-Tab": (cm) => cm.indentSelection("subtract"), "Ctrl-/": "toggleComment", "Ctrl-F": "findPersistent", "Ctrl-G": "findNext", "Shift-Ctrl-G": "findPrev", "Ctrl-H": "replace", "Alt-G": "jumpToLine" } });
    IDE.cm.on("cursorActivity", ideStatus);
    IDE.cm.on("change", () => { const f = curFile(); if (f) { const d = !f.doc.isClean(); if (d !== f.dirty) { f.dirty = d; ideTabs(); renderTree(); } } });
  }
  const curFile = () => { const s = ist(); return s.files.get(s.cur); };
  const kbs = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : n >= 1024 ? (n / 1024).toFixed(1) + " Ko" : n + " o");

  async function ideShow() {
    if (!S.cur) return msg("bad", "Choisissez d'abord un dépôt dans « Mes dépôts ».");
    $("dv-ide").hidden = false; $("ide-title").textContent = S.cur;
    try { await loadCM(); } catch (e) { return imsg("bad", "Éditeur indisponible : " + e.message); }
    ensureEditor();
    const s = ist();
    if (!s.dirs.has(".")) await loadDir(".", true); else renderTree();
    ideActivate(s.cur || "");
    $("dv-ide").scrollIntoView({ block: "nearest" });
  }
  function ideSync() { if (!$("dv-ide").hidden) ideShow(); }
  async function loadDir(p, open) {
    try {
      const r = await api(`/api/dev/tree?repo=${encodeURIComponent(S.cur)}&path=${encodeURIComponent(p)}`);
      const s = ist(), old = s.dirs.get(p); s.dirs.set(p, { items: r.items, open: open === undefined ? !!(old && old.open) : open });
    } catch (e) { imsg("bad", e.message); }
    renderTree();
  }
  function renderTree() {
    const s = ist(), rows = [`<div class="ide-n d${s.sel === "." ? " on" : ""}" data-p="." data-t="d"><span class="ide-ic">⌂</span>${esc(S.cur)}</div>`];
    const walk = (dir, depth) => {
      const d = s.dirs.get(dir); if (!d || !d.open) return;
      for (const it of d.items) {
        const p = dir === "." ? it.name : dir + "/" + it.name, isd = it.type === "d", o = isd && s.dirs.get(p) && s.dirs.get(p).open, f = s.files.get(p);
        rows.push(`<div class="ide-n ${isd ? "d" : "f"}${p === s.sel ? " on" : ""}${p === s.cur ? " cur" : ""}" style="padding-left:${8 + depth * 14}px" data-p="${esc(p)}" data-t="${it.type}" role="treeitem" title="${esc(p)}"><span class="ide-ic">${isd ? (o ? "▾" : "▸") : "·"}</span>${esc(it.name)}${f && f.dirty ? "<em>●</em>" : ""}</div>`);
        if (isd && o) walk(p, depth + 1);
      }
    };
    walk(".", 1); $("ide-tree").innerHTML = rows.join("");
  }
  function ideTabs() {
    const s = ist();
    $("ide-tabs").innerHTML = [...s.files].map(([p, f]) => `<button class="ide-tab${p === s.cur ? " on" : ""}${f.dirty ? " dirty" : ""}" data-p="${esc(p)}" role="tab" title="${esc(p)}"><b>${esc(p.split("/").pop())}</b><em data-x="${esc(p)}" title="Fermer">✕</em></button>`).join("");
    const f = curFile(); $("ide-save").disabled = !(f && f.dirty);
  }
  function ideStatus() {
    const f = curFile(), el = $("ide-status");
    if (!f) { el.innerHTML = ""; return; }
    const c = IDE.cm.getCursor();
    el.innerHTML = `<span>Ln <b>${c.line + 1}</b>, Col <b>${c.ch + 1}</b></span><span>${esc(f.label)}</span><span>${f.crlf ? "CRLF" : "LF"}</span><span>${IDE.cm.getOption("indentWithTabs") ? "Tabulations" : "Espaces : 4"}</span><span>${kbs(f.size)}</span><span>${esc(f.path)}</span>`;
  }
  function ideActivate(p) {
    const s = ist(); s.cur = p; const f = s.files.get(p);
    if (f) { IDE.cm.swapDoc(f.doc); IDE.cm.setOption("readOnly", false); IDE.cm.setOption("indentWithTabs", f.tabs); $("ide-empty").hidden = true; s.sel = p; }
    else { IDE.cm.swapDoc(CodeMirror.Doc("", "text/plain")); IDE.cm.setOption("readOnly", "nocursor"); $("ide-empty").hidden = false; }
    ideTabs(); renderTree(); ideStatus(); IDE.cm.refresh(); if (f) IDE.cm.focus();
  }
  async function ideOpenFile(p) {
    const s = ist(); if (s.files.has(p)) return ideActivate(p);
    imsg("run", "Ouverture de " + p + "…");
    try {
      const repo = S.cur, r = await api(`/api/dev/file?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(p)}`);
      const st = IDE.all[repo], crlf = r.text.includes("\r\n"), [mode, label] = modeFor(p, r.text);
      const doc = CodeMirror.Doc(r.text, mode, 0, crlf ? "\r\n" : "\n");
      st.files.set(p, { path: p, doc, dirty: false, crlf, label, size: r.size, tabs: /^\t/m.test(r.text) || mode === "makefile" || mode === "text/x-go" });
      imsg("", "");
      if (repo === S.cur) ideActivate(p);
    } catch (e) { imsg("bad", e.message); }
  }
  async function ideSave() {
    const f = curFile(); if (!f) return;
    const repo = S.cur;
    try {
      const text = f.doc.getValue(); await post("/api/dev/file/save", { repo, path: f.path, content: text });
      f.doc.markClean(); f.dirty = false; f.size = new Blob([text]).size; ideTabs(); renderTree(); ideStatus(); imsg("ok", `${f.path} enregistré dans WSL.`);
    } catch (e) { imsg("bad", "Sauvegarde impossible : " + e.message); }
  }
  function closeFile(p, force) {
    const s = ist(), f = s.files.get(p); if (!f) return;
    if (f.dirty && !force) return askBar(`« ${p} » a des modifications non enregistrées.`, [["FERMER SANS SAUVEGARDER", () => closeFile(p, true), true], ["ANNULER"]]);
    s.files.delete(p);
    if (s.cur === p) { const rest = [...s.files.keys()]; ideActivate(rest.length ? rest[rest.length - 1] : ""); } else { ideTabs(); renderTree(); }
  }
  // barre de saisie / confirmation (pas de prompt() ni confirm() : bloqués dans la fenêtre native)
  function askBar(label, buttons, input) {
    const bar = $("ide-bar"); bar.innerHTML = `<span>${esc(label)}</span>${input ? `<input type="text" id="ide-bar-in" value="${esc(input.value || "")}" placeholder="${esc(input.ph || "")}" spellcheck="false" autocomplete="off">` : ""}` +
      buttons.map((b, i) => `<button type="${i === 0 ? "submit" : "button"}" class="btn sm${b[2] ? " del" : ""}" data-b="${i}">${esc(b[0])}</button>`).join("");
    bar.hidden = false;
    const done = () => { bar.hidden = true; bar.innerHTML = ""; };
    bar.onsubmit = (e) => { e.preventDefault(); const v = input ? $("ide-bar-in").value.trim() : ""; done(); if (buttons[0][1]) buttons[0][1](v); };
    bar.onclick = (e) => { const b = e.target.closest("[data-b]"); if (b && b.dataset.b !== "0") { done(); const fn = buttons[+b.dataset.b][1]; if (fn) fn(); } };
    bar.onkeydown = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(); } };
    const i = $("ide-bar-in"); if (i) { i.focus(); i.select(); } else bar.querySelector("button").focus();
  }
  const isDirNode = (p) => !!document.querySelector(`#ide-tree .ide-n.d[data-p="${CSS.escape(p)}"]`);
  const targetDir = () => { const s = ist(); if (s.sel === "." || isDirNode(s.sel)) return s.sel; return s.sel.includes("/") ? s.sel.slice(0, s.sel.lastIndexOf("/")) : "."; };
  function ideNew(kind) {
    if (!S.cur) return; const dir = targetDir();
    askBar(`${kind === "dir" ? "Nouveau dossier" : "Nouveau fichier"} dans ${dir === "." ? "/" : dir + "/"} :`, [["CRÉER", async (name) => {
      if (!name) return; const p = dir === "." ? name : dir + "/" + name;
      try {
        await post("/api/dev/fs/create", { repo: S.cur, path: p, kind });
        await ideReload(kind === "dir" ? p : p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");      // déplie le dossier parent du nouvel élément
        if (kind === "dir") ist().sel = p; else await ideOpenFile(p);
        renderTree(); imsg("ok", `${p} créé.`);
      } catch (e) { imsg("bad", e.message); }
    }], ["ANNULER"]], { ph: kind === "dir" ? "nom-du-dossier" : "nom.c  ou  dossier/nom.py" });
  }
  function ideDelete() {
    const s = ist(), p = s.sel; if (!p || p === ".") return imsg("bad", "Sélectionnez d'abord un fichier ou un dossier à supprimer.");
    const isDir = isDirNode(p);
    askBar(`Supprimer définitivement « ${p} »${isDir ? " et tout son contenu" : ""} ?`, [["SUPPRIMER", async () => {
      try {
        await post("/api/dev/fs/delete", { repo: S.cur, path: p });
        for (const k of [...s.files.keys()]) if (k === p || k.startsWith(p + "/")) s.files.delete(k);
        for (const k of [...s.dirs.keys()]) if (k === p || k.startsWith(p + "/")) s.dirs.delete(k);
        s.sel = "."; if (!s.files.has(s.cur)) s.cur = [...s.files.keys()].pop() || "";
        await ideReload(); ideActivate(s.cur); imsg("ok", `${p} supprimé.`);
      } catch (e) { imsg("bad", e.message); }
    }, true], ["ANNULER"]]);
  }
  // recharge tous les dossiers ouverts (et déplie « ensure » ainsi que ses parents)
  async function ideReload(ensure) {
    const s = ist();
    if (ensure && ensure !== ".") { let a = ""; for (const seg of ensure.split("/")) { a = a ? a + "/" + seg : seg; const d = s.dirs.get(a); if (d) d.open = true; else s.dirs.set(a, { items: [], open: true }); } }
    for (const p of [...s.dirs.keys()]) { const d = s.dirs.get(p); if (p === "." || d.open) await loadDir(p, true); }
    renderTree();
  }
  $("ide-tree").onclick = async (e) => {
    const n = e.target.closest(".ide-n"); if (!n) return; const s = ist(), p = n.dataset.p; s.sel = p;
    if (n.dataset.t === "d") {
      if (p === ".") return renderTree();
      const d = s.dirs.get(p); if (d && d.items.length) { d.open = !d.open; renderTree(); } else await loadDir(p, true);
    } else { renderTree(); await ideOpenFile(p); }
  };
  $("ide-tree").oncontextmenu = (e) => {
    const n = e.target.closest(".ide-n"), s = ist(); if (n) { s.sel = n.dataset.p; renderTree(); }
    showCtx(e, [{ label: "Nouveau fichier ici…", run: () => ideNew("file") }, { label: "Nouveau dossier ici…", run: () => ideNew("dir") }, "-",
      { label: "Supprimer…", off: !n || n.dataset.p === ".", run: ideDelete }, { label: "Actualiser", run: () => ideReload() }]);
  };
  $("ide-tabs").onclick = (e) => { const x = e.target.closest("[data-x]"); if (x) return closeFile(x.dataset.x); const t = e.target.closest(".ide-tab"); if (t) ideActivate(t.dataset.p); };
  $("ide-tabs").onauxclick = (e) => { const t = e.target.closest(".ide-tab"); if (t && e.button === 1) closeFile(t.dataset.p); };
  $("ide-save").onclick = ideSave;
  $("ide-nf").onclick = () => ideNew("file"); $("ide-nd").onclick = () => ideNew("dir"); $("ide-del").onclick = ideDelete; $("ide-rf").onclick = () => ideReload();
  $("ide-close").onclick = () => { $("dv-ide").hidden = true; $("dv-ide").classList.remove("full"); };
  $("ide-full").onclick = () => { $("dv-ide").classList.toggle("full"); if (IDE.cm) IDE.cm.refresh(); };
  $("dv-edit").onclick = () => { if ($("dv-ide").hidden) ideShow(); else $("ide-close").click(); };
  document.addEventListener("keydown", (e) => {                                      // Ctrl+S ne doit jamais ouvrir « Enregistrer la page »
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !$("dv").hidden && !$("dv-ide").hidden) { e.preventDefault(); ideSave(); }
  });
})();
