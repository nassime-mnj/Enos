"use strict";
// Code Academy — moteur : Monaco (VS Code), lecteur pas à pas animé, compilation animée, exercices + correcteur, atelier, quiz, progression.
(() => {
  const A = window.ACAD, $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const par = (() => { try { return window.parent && window.parent !== window && window.parent.fetch ? window.parent : null; } catch (e) { return null; } })();
  // Édition téléphone : la page est ouverte par le module mobile (m_academy.js), qui fournit l'exécution via le cloud ; pas de Monaco (12 Mo) mais un éditeur léger.
  const HOST = (par && par.ENOS && par.ENOS.academy) || null, MOBILE = !!HOST;
  const rawFetch = par ? par.fetch.bind(par) : fetch.bind(window);
  const api = async (path, body) => {
    const r = await rawFetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || r.statusText);
    return j;
  };
  // ------------------------------------------------------------------ stockage
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } } };
  const P = Object.assign({ done: {}, ex: {}, quiz: 0, xp: 0, comp: 0, last: "", streak: 0, lang: "python", order: "asc" }, ls.get("acad.v1", {}));
  const CFG = Object.assign({ speed: 1, font: 14, minimap: true, theme: "acad", anim: true, auto: true, ligatures: true }, ls.get("acad.cfg", {}));
  const save = () => { ls.set("acad.v1", P); ls.set("acad.cfg", CFG); };
  const day = () => new Date().toISOString().slice(0, 10);
  const stats = () => ({ done: Object.keys(P.done).length, ex: Object.keys(P.ex).length, quiz: P.quiz, comp: P.comp, streak: P.streak, langs: new Set(Object.keys(P.done).map((k) => k.split(":")[0])).size });
  const rankOf = (xp) => { let i = 0; A.ranks.forEach((r, k) => { if (xp >= r[0]) i = k; }); const nx = A.ranks[i + 1]; return { n: A.ranks[i][1], pct: nx ? (xp - A.ranks[i][0]) / (nx[0] - A.ranks[i][0]) : 1 }; };
  function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.innerHTML = msg; document.body.append(t); setTimeout(() => t.remove(), 3200); }
  function confetti() { if (!CFG.anim) return; const cols = ["#00ff9c", "#4cc3ff", "#ffb454", "#ff5c7a", "#c792ea"]; for (let i = 0; i < 60; i++) { const c = document.createElement("i"); c.className = "confetti"; c.style.cssText = `left:${Math.random() * 100}vw;background:${cols[i % 5]};animation-delay:${Math.random() * .5}s;animation-duration:${1.4 + Math.random()}s`; document.body.append(c); setTimeout(() => c.remove(), 3000); } }
  function addXP(n, why) {
    const before = new Set(A.badges.filter((b) => b.f(stats())).map((b) => b.id)), rb = rankOf(P.xp).n;
    P.xp += n;
    if (P.last !== day()) { const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10); P.streak = P.last === y ? P.streak + 1 : 1; P.last = day(); }
    save(); header();
    toast(`+${n} XP <span class="muted">· ${esc(why)}</span>`);
    A.badges.filter((b) => b.f(stats()) && !before.has(b.id)).forEach((b) => setTimeout(() => { toast(`${b.e} Succès : <b>${esc(b.n)}</b>`); confetti(); }, 900));
    if (rankOf(P.xp).n !== rb) setTimeout(() => { toast(`🎖️ Nouveau rang : <b>${esc(rankOf(P.xp).n)}</b>`); confetti(); }, 1500);
  }
  function header() {
    const r = rankOf(P.xp);
    $("#rank").textContent = r.n; $("#xp").textContent = P.xp + " XP"; $("#xpbar").style.width = Math.round(r.pct * 100) + "%";
    $("#streak").textContent = P.streak ? "🔥" + P.streak : "";
    document.documentElement.style.setProperty("--sp", CFG.speed);
  }
  // ------------------------------------------------------------------ Monaco (moteur de VS Code)
  let monacoP = null;
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.append(s); });
  function ensureMonaco() {
    if (monacoP) return monacoP;
    if (MOBILE) { window.monaco = window.monaco || MONACO_SHIM; return (monacoP = Promise.resolve(window.monaco)); }
    monacoP = (async () => {
      const EXT = "/static/ext/", base = location.origin + EXT + "monaco/";
      await loadScript(EXT + "monaco/vs/loader.js");
      await new Promise((res, rej) => {
        window.require.config({ paths: { vs: EXT + "monaco/vs" }, "vs/nls": { availableLanguages: { "*": "fr" } } });
        window.MonacoEnvironment = { getWorkerUrl: () => URL.createObjectURL(new Blob([`self.MonacoEnvironment={baseUrl:'${base}'};importScripts('${base}vs/base/worker/workerMain.js');`], { type: "text/javascript" })) };
        window.require(["vs/editor/editor.main"], res, rej);
      });
      window.monaco.editor.defineTheme("acad", { base: "vs-dark", inherit: true, rules: [{ token: "keyword", foreground: "00ff9c", fontStyle: "bold" }, { token: "comment", foreground: "6b7a90", fontStyle: "italic" }, { token: "string", foreground: "f5d76e" }, { token: "number", foreground: "ff9d5c" }, { token: "type", foreground: "4cc3ff" }],
        colors: { "editor.background": "#0b0d10", "editorLineNumber.foreground": "#4b5565", "editorLineNumber.activeForeground": "#00ff9c", "editorCursor.foreground": "#00ff9c", "editor.selectionBackground": "#1f6f5a88", "editor.lineHighlightBackground": "#ffffff0a" } });
      return window.monaco;
    })();
    return monacoP;
  }
  // --- éditeur léger (téléphone) : même interface que celle de Monaco utilisée plus bas (getValue, setValue, deltaDecorations, …)
  class MiniEditor {
    constructor(host, value, o) {
      this.fs = (o && o.fontSize) || CFG.font; this.lh = Math.round(this.fs * 1.55); this.cbs = []; this.notes = {}; this.bands = [];
      host.innerHTML = `<div class="mini"><div class="mini-gut"></div><div class="mini-scroll"><div class="mini-bands"></div><textarea spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off"></textarea></div></div>`;
      this.root = host.firstChild; this.gut = this.root.querySelector(".mini-gut"); this.sc = this.root.querySelector(".mini-scroll"); this.bn = this.root.querySelector(".mini-bands"); this.ta = this.root.querySelector("textarea");
      this.root.style.cssText = `--lh:${this.lh}px;--fs:${this.fs}px`;
      this.ta.value = value; this.ta.readOnly = !!(o && o.readOnly);
      this.ta.addEventListener("input", () => { this.fit(); this.cbs.forEach((f) => f()); });
      this.ta.addEventListener("keydown", (e) => { if (e.key === "Tab") { e.preventDefault(); const a = this.ta.selectionStart; this.ta.setRangeText("    ", a, this.ta.selectionEnd, "end"); this.ta.dispatchEvent(new Event("input")); } });
      this.sc.addEventListener("scroll", () => { this.gut.scrollTop = this.sc.scrollTop; });
      this.gut.addEventListener("click", (e) => { const n = +(e.target.dataset && e.target.dataset.l); if (n && this.notes[n]) toast("💡 " + esc(this.notes[n])); });
      this.fit();
    }
    lines() { return this.ta.value.split("\n").length; }
    fit() { const n = this.lines(); this.gut.innerHTML = Array.from({ length: n }, (_, i) => `<div data-l="${i + 1}" class="${this.notes[i + 1] ? "has" : ""}">${i + 1}</div>`).join(""); this.ta.style.height = (n * this.lh + 24) + "px"; this.bn.style.height = (n * this.lh + 24) + "px"; }
    getValue() { return this.ta.value; }
    setValue(v) { this.ta.value = v; this.fit(); this.cbs.forEach((f) => f()); }
    onDidChangeModelContent(f) { this.cbs.push(f); }
    addCommand() { /* pas de raccourcis clavier sur téléphone */ }
    updateOptions(o) { if (o && o.fontSize) { this.fs = o.fontSize; this.lh = Math.round(o.fontSize * 1.55); this.root.style.cssText = `--lh:${this.lh}px;--fs:${this.fs}px`; this.fit(); this.paint(); } }
    deltaDecorations(old, nw) {
      if (old && old.length) this.bands = this.bands.filter((b) => !old.includes(b.id));
      const ids = [];
      (nw || []).forEach((d) => { const id = "d" + (this._n = (this._n || 0) + 1); ids.push(id); this.bands.push({ id, l: d.range.startLineNumber, cls: d.options.className || "", note: d.options.hoverMessage && d.options.hoverMessage.value }); if (d.options.hoverMessage) this.notes[d.range.startLineNumber] = String(d.options.hoverMessage.value).replace(/^💡\s*/, ""); });
      this.fit(); this.paint(); return ids;
    }
    paint() { this.bn.innerHTML = this.bands.map((b) => `<div class="mini-band ${b.cls}" style="top:${12 + (b.l - 1) * this.lh}px;height:${this.lh}px"></div>`).join(""); }
    revealLineInCenterIfOutsideViewport(l) { const y = 12 + (l - 1) * this.lh, h = this.sc.clientHeight; if (y < this.sc.scrollTop + this.lh || y > this.sc.scrollTop + h - this.lh * 2) this.sc.scrollTop = Math.max(0, y - h / 2); }
    dispose() { this.root.remove(); }
  }
  const MONACO_SHIM = { Range: class { constructor(a, b, c, d) { this.startLineNumber = a; this.startColumn = b; this.endLineNumber = c; this.endColumn = d; } }, KeyMod: { CtrlCmd: 0 }, KeyCode: { Enter: 0 }, editor: { setTheme() { /* thème unique */ } } };
  const edOpts = (o) => Object.assign({ theme: CFG.theme, fontSize: CFG.font, fontFamily: "Consolas,'Cascadia Code',monospace", fontLigatures: CFG.ligatures, minimap: { enabled: CFG.minimap }, automaticLayout: true, scrollBeyondLastLine: false, glyphMargin: true, smoothScrolling: true, cursorSmoothCaretAnimation: "on", renderLineHighlight: "all", padding: { top: 8 }, bracketPairColorization: { enabled: true }, "semanticHighlighting.enabled": true }, o);
  const editors = [];
  async function mkEditor(host, value, lang, o) {
    const m = await ensureMonaco();
    if (MOBILE) { const mini = new MiniEditor(host, value, o); editors.push(mini); return mini; }
    const ed = m.editor.create(host, edOpts(Object.assign({ value, language: (A.langs.find((l) => l.id === lang) || {}).mo || lang }, o || {})));
    editors.push(ed); return ed;
  }
  function disposeEditors() { while (editors.length) { try { editors.pop().dispose(); } catch (e) { /* déjà détruit */ } } }
  // ------------------------------------------------------------------ exécution
  function runJS(code, stdin) {
    return new Promise((res) => {
      const src = `let _o=[];const _f=(x)=>typeof x==='string'?x:(()=>{try{return JSON.stringify(x)}catch(e){return String(x)}})();
self.console={log:(...a)=>_o.push(a.map(_f).join(' ')),error:(...a)=>_o.push(a.map(_f).join(' ')),warn:(...a)=>_o.push(a.map(_f).join(' ')),info:(...a)=>_o.push(a.map(_f).join(' '))};
const _in=${JSON.stringify(stdin || "")}.split('\\n');let _i=0;self.readline=()=>_i<_in.length?_in[_i++]:null;self.prompt=self.readline;
let _e='';try{(0,eval)(${JSON.stringify(code)})}catch(e){_e='Erreur : '+e.message}
setTimeout(()=>postMessage({out:_o.join('\\n')+(_o.length?'\\n':''),err:_e}),300);`;
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      const t = setTimeout(() => { w.terminate(); res({ ok: false, stdout: "", stderr: "Délai dépassé (boucle infinie ?)", phase: "run", timeout: true }); }, 6000);
      w.onmessage = (e) => { clearTimeout(t); w.terminate(); res({ ok: !e.data.err, stdout: e.data.out, stderr: e.data.err, phase: "run" }); };
      w.onerror = (e) => { clearTimeout(t); w.terminate(); res({ ok: false, stdout: "", stderr: "Erreur : " + e.message, phase: "run" }); };
    });
  }
  async function runCode(lang, code, stdin) {
    if (lang === "js") return runJS(code, stdin);
    if (MOBILE) { try { return await HOST.run(lang, code, stdin || ""); } catch (e) { return { ok: false, phase: "run", stdout: "", stderr: "Exécution impossible : " + e.message, missing: true }; } }
    try { return await api("/api/academy/run", { lang, code, stdin: stdin || "" }); } catch (e) { return { ok: false, phase: "setup", stdout: "", stderr: "Serveur ENOS injoignable : ouvre la page depuis ENOS. (" + e.message + ")", missing: true }; }
  }
  let TOOLS = {};
  async function loadTools() {
    if (MOBILE) { const up = !!(HOST.online && HOST.online()); TOOLS = { python: up, c: up, cpp: up, java: up, shell: up, js: true, vscode: false }; }
    else { try { TOOLS = await api("/api/academy/status"); } catch (e) { TOOLS = {}; } }
    TOOLS.js = true;
    $("#st-tools").innerHTML = A.langs.map((l) => `<span class="t ${TOOLS[l.id] ? "on" : ""}" title="${TOOLS[l.id] ? "exécution réelle" : "outil absent : correction statique seulement"}">${l.n} ${TOOLS[l.id] ? "✓" : "✗"}</span>`).join(" ") + ` <span class="t ${TOOLS.vscode ? "on" : ""}">VS Code ${TOOLS.vscode ? "✓" : "✗"}</span>`;
  }
  // ------------------------------------------------------------------ rendu markdown léger
  const md = (s) => {
    const blocks = []; s = String(s).replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) => { blocks.push(`<pre>${esc(c.replace(/\n$/, ""))}</pre>`); return `\u0000${blocks.length - 1}\u0000`; });
    s = esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/^### (.*)$/gm, "<h3>$1</h3>").replace(/^- (.*)$/gm, "<li>$1</li>").replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`).replace(/\n\n/g, "<br><br>");
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  };
  // ------------------------------------------------------------------ vues
  let view = "learn", lang = P.lang, cur = null;           // cur = { lesson, i }
  const L = () => A.lessons[lang] || [];
  const sorted = () => { const a = L().map((x, i) => ({ x, i })); a.sort((p, q) => (P.order === "desc" ? q.x.lv - p.x.lv : p.x.lv - q.x.lv) || p.i - q.i); return a; };
  const key = (les) => lang + ":" + les.id;
  function setView(v) {
    view = v; $$("#act button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    disposeEditors(); stopPlay(); renderSide(); renderWork();
  }
  function renderLangs() {
    $("#langs").innerHTML = A.langs.map((l) => `<button data-l="${l.id}" class="${l.id === lang ? "on" : ""}">${l.ic} ${l.n}</button>`).join("");
    $$("#langs button").forEach((b) => (b.onclick = () => { lang = b.dataset.l; P.lang = lang; save(); cur = null; renderLangs(); setView(view); }));
  }
  function renderSide() {
    const s = $("#side");
    if (view === "learn") {
      const d = L().filter((x) => P.done[key(x)]).length;
      s.innerHTML = `<h3>Parcours ${esc(A.langs.find((l) => l.id === lang).n)} · ${d}/${L().length}</h3>
        <div class="order"><button data-o="asc" class="${P.order === "asc" ? "on" : ""}">Facile → Dur</button><button data-o="desc" class="${P.order === "desc" ? "on" : ""}">Dur → Facile</button></div>` +
        sorted().map(({ x, i }, n) => `<div class="chap ${P.done[key(x)] ? "done" : ""} ${cur && cur.i === i ? "on" : ""}"><button class="ch" data-i="${i}"><span class="num">${P.done[key(x)] ? "✓" : n + 1}</span><span><b>${esc(x.t)}</b><br><span class="meta">${x.min} min · ${x.ex ? "exercice" : "cours"}</span></span><span class="lv">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= x.lv ? "f" : ""}"></i>`).join("")}</span></button></div>`).join("");
      $$(".order button", s).forEach((b) => (b.onclick = () => { P.order = b.dataset.o; save(); renderSide(); }));
      $$(".ch", s).forEach((b) => (b.onclick = () => { openLesson(+b.dataset.i); }));
    } else if (view === "compile") {
      s.innerHTML = `<h3>Compilation animée</h3><p class="muted" style="padding:0 4px">Ce qui se passe entre ton code source et l'exécution, étape par étape, pour ${esc(A.langs.find((l) => l.id === lang).n)}.</p>`;
    } else if (view === "lab") {
      s.innerHTML = `<h3>Atelier</h3><p class="muted" style="padding:0 4px">Un vrai éditeur VS Code (Monaco) : coloration, auto-complétion, palette de commandes (<b>F1</b>), recherche, multi-curseurs. Écris, exécute, ou visualise ton propre code Python pas à pas.</p>
        <h3>Modèles</h3>` + (A.templates && A.templates[lang] ? A.templates[lang].map((t, i) => `<div class="chap"><button class="ch" data-t="${i}"><span class="num">▸</span><b>${esc(t.n)}</b></button></div>`).join("") : "");
      $$("[data-t]", s).forEach((b) => (b.onclick = () => { if (labEd) labEd.setValue(A.templates[lang][+b.dataset.t].code); }));
    } else if (view === "quiz") s.innerHTML = `<h3>Prédis la sortie</h3><p class="muted" style="padding:0 4px">Lis le code, devine ce qu'il affiche. Chaque bonne réponse rapporte de l'XP et entraîne ton « œil de compilateur ».</p>`;
    else if (view === "sheet") s.innerHTML = `<h3>Aide-mémoire</h3><p class="muted" style="padding:0 4px">Les réflexes de ${esc(A.langs.find((l) => l.id === lang).n)} sur une page.</p>`;
    else s.innerHTML = `<h3>Progression</h3><p class="muted" style="padding:0 4px">Rangs, succès et avancement par langage.</p>`;
  }
  function renderWork() {
    const w = $("#work");
    if (view === "learn") return cur ? lessonView() : (w.innerHTML = learnHome());
    if (view === "compile") return compileView();
    if (view === "lab") return labView();
    if (view === "quiz") return quizView();
    if (view === "sheet") { w.innerHTML = `<div class="scroll md">${md((A.sheets[lang] || "Fiche à venir.").trim())}</div>`; return; }
    statsView();
  }
  function learnHome() {
    const ls_ = L(), l = A.langs.find((x) => x.id === lang), d = ls_.filter((x) => P.done[key(x)]).length;
    setTimeout(() => $$("[data-go]").forEach((b) => (b.onclick = () => openLesson(+b.dataset.go))), 0);
    const next = sorted().find(({ x }) => !P.done[key(x)]);
    return `<div class="scroll"><div class="card"><h2>${l.ic} Deviens expert en ${esc(l.n)}</h2>
      <p class="muted">${ls_.length} chapitres courts. Chaque chapitre : un code qui <b>grandit par étapes</b>, un panneau qui explique <b>chaque ligne</b> pendant l'exécution, la <b>mémoire</b> animée (pile, tas, variables), puis un exercice noté par le correcteur automatique.</p>
      <div class="tags"><span class="tag why">Parcours : ${P.order === "asc" ? "du plus facile au plus dur" : "du plus dur au plus facile"}</span><span class="tag">${d}/${ls_.length} terminés</span></div>
      <div class="bar" style="width:100%;height:9px"><i style="width:${ls_.length ? Math.round(d / ls_.length * 100) : 0}%"></i></div>
      <div class="row" style="margin-top:14px">${next ? `<button class="btn pri" data-go="${next.i}">▶ ${d ? "Continuer" : "Commencer"} : ${esc(next.x.t)}</button>` : `<b style="color:var(--ok)">🏆 Parcours terminé !</b>`}</div></div>
      <div class="grid">${sorted().map(({ x, i }) => `<div class="card"><h3>${P.done[key(x)] ? "✅ " : ""}${esc(x.t)}</h3><div class="tags"><span class="tag why">à quoi ça sert : ${esc(x.why)}</span></div><div class="tags"><span class="tag when">quand : ${esc(x.when)}</span></div><button class="btn sm" data-go="${i}">Ouvrir</button></div>`).join("")}</div></div>`;
  }
  // ------------------------------------------------------------------ LECON : lecteur pas à pas
  const PL = { t: 0, i: -1, st: null, stage: 0, ed: null, deco: [], snaps: [], tab: "cours" };
  function stopPlay() { clearInterval(PL.t); PL.t = 0; const b = $("#b-play"); if (b) b.textContent = "▶"; }
  function openLesson(i) { cur = { lesson: L()[i], i }; PL.stage = 0; PL.tab = "cours"; disposeEditors(); stopPlay(); renderSide(); lessonView(); }
  // reconstruit l'état de la mémoire à l'étape i (rejouable : on peut reculer, glisser la barre)
  function snapshot(steps, i) {
    let frames = [{ n: "main", v: {} }], heap = {}, out = "", ret = null, pend = false; const prev = {};
    const copy = () => JSON.stringify(frames.map((f) => f.v));
    let before = copy();
    for (let k = 0; k <= i; k++) {
      const s = steps[k];
      if (pend) { frames.pop(); pend = false; }
      if (k === i) before = copy();
      if (s.push) frames.push({ n: s.push, v: {} });
      const top = frames[frames.length - 1];
      for (const n0 in s.v) {                                    // "main.x" : modifie la variable d'un AUTRE cadre (pointeur, référence…)
        let tgt = top, n = n0; const dot = n0.indexOf(".");
        if (dot > 0) { const fn = n0.slice(0, dot); n = n0.slice(dot + 1); for (let q = frames.length - 1; q >= 0; q--) if (frames[q].n === fn) { tgt = frames[q]; break; } }
        if (s.v[n0] === null) delete tgt.v[n]; else tgt.v[n] = s.v[n0];
      }
      for (const n in (s.h || {})) { if (s.h[n] === null) delete heap[n]; else heap[n] = s.h[n]; }
      out += s.o || ""; ret = s.ret != null ? s.ret : null;
      if (s.pop) pend = true;
    }
    return { frames, heap, out, ret, before: JSON.parse(before), s: steps[i] };
  }
  const fmtVal = (v) => {
    if (Array.isArray(v)) return `<span class="arr">${v.map((x, k) => `<span>${esc(typeof x === "object" && x ? "…" : x)}<em>${k}</em></span>`).join("")}</span>`;
    if (v && typeof v === "object" && v.k) return `<span class="arr">${(v.v || []).map((x, k) => `<span>${esc(Array.isArray(x) ? x.join(": ") : typeof x === "object" && x ? (x.k || "…") : x)}<em>${v.k === "dict" ? "" : k}</em></span>`).join("")}</span> <span class="t">${esc(v.k)}</span>`;
    return `<span class="v">${esc(v)}</span>`;
  };
  function memHTML(sn) {
    const fr = sn.frames.map((f, k) => {
      const old = (sn.before[k]) || {};
      const vars = Object.keys(f.v).filter((n) => !(typeof f.v[n] === "string" && /^ƒ/.test(f.v[n])) || true).map((n) => {
        const val = f.v[n], chg = JSON.stringify(old[n]) !== JSON.stringify(val);
        const isObj = Array.isArray(val) || (val && typeof val === "object");
        return `<div class="var ${chg && CFG.anim ? "chg" : ""}"><span class="n">${esc(n)}</span>${isObj ? fmtVal(val) : `<span class="v">${esc(val)}</span>`}</div>`;
      }).join("") || `<span class="muted" style="font-size:12px">(aucune variable)</span>`;
      return `<div class="frame"><b>${esc(f.n)}()</b>${vars}</div>`;
    }).join("");
    const hp = Object.keys(sn.heap).map((n) => `<div class="hobj"><b style="color:var(--warn)">${esc(n)}</b> → ${esc(sn.heap[n])}</div>`).join("");
    const T = lang === "shell" ? ["Variables du script", "Fichiers et tubes"] : lang === "js" ? ["Pile d'appels (call stack)", "Tas et files d'événements"] : ["Pile (stack)", "Tas (heap)"];
    return `<div class="mem"><div><h4>${T[0]}</h4><div class="stack">${fr}</div></div>${hp || sn.s.h ? `<div class="heap"><h4>${T[1]}</h4>${hp || '<span class="muted" style="font-size:12px">vide</span>'}</div>` : ""}</div>`;
  }
  function goStep(i) {
    const st = PL.st; if (!st || !st.steps.length) return;
    i = Math.max(-1, Math.min(st.steps.length - 1, i)); PL.i = i;
    const say = $("#say"), mem = $("#mem"), term = $("#out"), sl = $("#scrub");
    if (sl) sl.value = i + 1;
    $("#stepno").textContent = `${i + 1}/${st.steps.length}`;
    const m = window.monaco;
    if (i < 0) { say.innerHTML = `<div class="say">Appuie sur <b>▶</b> (ou sur <b>→</b>) : le code s'exécute <b>une ligne à la fois</b> et je t'explique ce qui se passe.</div>`; mem.innerHTML = ""; term.innerHTML = '<span class="dim">$ </span><span class="cur"></span>'; if (PL.ed) PL.deco = PL.ed.deltaDecorations(PL.deco, []); return; }
    const sn = snapshot(st.steps, i), s = st.steps[i];
    say.innerHTML = `<div class="say">${md(s.t)}${sn.ret != null ? `<br><b>↩ renvoie</b> <code>${esc(sn.ret)}</code>` : ""}</div>`;
    mem.innerHTML = memHTML(sn);
    term.innerHTML = `<span class="dim">$ </span>${esc(sn.out)}<span class="cur"></span>`; term.scrollTop = term.scrollHeight;
    if (PL.ed && m) {
      const past = []; for (let k = 0; k < i; k++) past.push(st.steps[k].l);
      PL.deco = PL.ed.deltaDecorations(PL.deco, [...[...new Set(past)].filter((l) => l !== s.l).map((l) => ({ range: new m.Range(l, 1, l, 1), options: { isWholeLine: true, className: "hl-done" } })), { range: new m.Range(s.l, 1, s.l, 1), options: { isWholeLine: true, className: "hl-line", glyphMarginClassName: "hl-glyph" } }]);
      PL.ed.revealLineInCenterIfOutsideViewport(s.l);
    }
    // fin de leçon : dernière étape du dernier code vue
    const les = cur && cur.lesson;
    if (les && !les.ex && PL.stage === les.stages.length - 1 && i === st.steps.length - 1 && !P.done[key(les)]) { P.done[key(les)] = 1; addXP(10 + les.lv * 2, "leçon terminée"); renderSide(); }
  }
  function play() {
    if (PL.t) return stopPlay();
    if (PL.i >= PL.st.steps.length - 1) goStep(-1);
    $("#b-play").textContent = "⏸";
    PL.t = setInterval(() => { if (PL.i >= PL.st.steps.length - 1) { stopPlay(); return; } goStep(PL.i + 1); }, 1500 / CFG.speed);
  }
  async function lessonView() {
    const les = cur.lesson, stg = les.stages[PL.stage]; PL.st = stg; PL.i = -1;
    const w = $("#work"); disposeEditors(); stopPlay();
    const tabs = ["cours", ...(les.ex ? ["exercice"] : []), ...(les.quiz && les.quiz.length ? ["quiz"] : [])];
    w.innerHTML = `<div class="lesson"><div class="lhead"><h2>${esc(les.t)} <span class="lv">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= les.lv ? "f" : ""}"></i>`).join("")}</span></h2>
      <div class="tags"><span class="tag why">À quoi ça sert : ${esc(les.why)}</span><span class="tag when">Quand l'utiliser : ${esc(les.when)}</span></div>
      <div class="tabs" style="padding:0;margin-top:4px">${tabs.map((t) => `<button data-tab="${t}" class="${PL.tab === t ? "on" : ""}">${{ cours: "📖 Cours animé", exercice: "🧪 Exercice + correcteur", quiz: "🎯 Quiz" }[t]}</button>`).join("")}</div></div>
      <div id="lcont" style="flex:1;min-height:0"></div></div>`;
    $$("[data-tab]", w).forEach((b) => (b.onclick = () => { PL.tab = b.dataset.tab; lessonView(); }));
    if (PL.tab === "exercice") return exView(les, $("#lcont"));
    if (PL.tab === "quiz") return lessonQuiz(les, $("#lcont"));
    $("#lcont").innerHTML = `<div class="lbody" style="height:100%"><div class="ed"><div class="edhost" id="edh"></div>
      <div class="ctl"><button class="btn" id="b-prev" title="Précédent (←)">⏮</button><button class="btn pri" id="b-play" title="Lecture (espace)">▶</button><button class="btn" id="b-next" title="Suivant (→)">⏭</button>
      <input type="range" id="scrub" min="0" max="${stg.steps.length}" value="0"><span id="stepno" class="muted" style="font-size:12px;min-width:44px">0/${stg.steps.length}</span>
      <button class="btn" id="b-run" title="Exécuter pour de vrai">⚡ Exécuter</button><button class="btn" id="b-code" title="Ouvrir dans VS Code">${MOBILE ? "Copier" : "VS Code"}</button></div></div>
      <div class="panel" style="border-bottom:1px solid var(--line)"><div class="stages" style="margin:0 0 10px">${les.stages.map((s, k) => `<button data-st="${k}" class="${k === PL.stage ? "on" : ""}">${k + 1}. ${esc(s.t)}</button>`).join("")}</div><h4>Ce qui se passe</h4><div id="say"></div><div style="height:12px"></div><h4>Mémoire</h4><div id="mem"></div></div>
      <div class="term" id="out"></div></div>`;
    $$("[data-st]").forEach((b) => (b.onclick = () => { PL.stage = +b.dataset.st; lessonView(); }));
    const ed = await mkEditor($("#edh"), stg.code, lang);
    PL.ed = ed; PL.deco = [];
    // notes : survol d'une ligne annotée = explication de l'élément
    const m = window.monaco, nd = Object.keys(stg.notes || {}).map((l) => ({ range: new m.Range(+l, 1, +l, 1), options: { isWholeLine: true, className: "note-line", hoverMessage: { value: "💡 " + stg.notes[l] } } }));
    ed.deltaDecorations([], nd);
    $("#b-play").onclick = play; $("#b-next").onclick = () => { stopPlay(); goStep(PL.i + 1); }; $("#b-prev").onclick = () => { stopPlay(); goStep(PL.i - 1); };
    $("#scrub").oninput = (e) => { stopPlay(); goStep(+e.target.value - 1); };
    $("#b-run").onclick = async () => { const o = $("#out"); o.innerHTML = '<span class="dim">exécution…</span>'; const r = await runCode(lang, ed.getValue(), ""); o.innerHTML = fmtRun(r); };
    $("#b-code").onclick = () => toVSCode(ed.getValue(), les.id);
    goStep(-1);
    if (CFG.auto) setTimeout(() => { if (PL.tab === "cours" && PL.i < 0) play(); }, 700);
  }
  const fmtRun = (r) => {
    if (r.missing) return `<span class="err">${esc(r.stderr)}</span>\n<span class="dim">Astuce : la correction statique reste active, et tu peux ouvrir le code dans VS Code.</span>`;
    return `${r.phase === "compile" ? '<span class="err">✗ erreur de compilation</span>\n' : ""}${esc(r.stdout || "")}${r.stderr ? `<span class="${r.ok ? "dim" : "err"}">${esc(r.stderr)}</span>` : ""}${r.timeout ? '<span class="err">\n⏱ trop long (8 s)</span>' : ""}<span class="${r.ok ? "ok" : "err"}">\n${r.ok ? "✓ terminé" : "✗ échec"}${r.ms != null ? " · " + r.ms + " ms" : ""}</span>`;
  };
  async function toVSCode(code, name) {
    if (MOBILE) { try { await navigator.clipboard.writeText(code); toast("Code copié : colle-le dans ton éditeur"); } catch (e) { toast("Copie impossible sur cet appareil"); } return; }
    try { const r = await api("/api/academy/vscode", { lang, code, name }); toast(r.ok ? "Ouvert dans VS Code · " + esc(r.path) : esc(r.error)); } catch (e) { toast("Impossible : " + esc(e.message)); }
  }
  // ------------------------------------------------------------------ EXERCICE + correcteur
  async function exView(les, host) {
    const ex = les.ex, k = key(les), saved = ls.get("acad.code." + k, null);
    host.innerHTML = `<div class="ex"><div class="edcol"><div class="edhost" id="edh"></div><div class="ctl"><button class="btn pri" id="b-grade">✅ Corriger</button><button class="btn" id="b-hint">💡 Indice</button><button class="btn" id="b-reset">↺ Départ</button><button class="btn" id="b-sol">👁 Solution</button><span class="grow"></span><button class="btn" id="b-code">VS Code</button></div></div>
      <div class="side2"><div class="panel" style="flex:0 0 auto;max-height:36%"><h4>Énoncé</h4><div class="md">${md(ex.prompt)}</div><div id="hint" class="muted" style="margin-top:8px"></div></div>
      <div class="panel" style="flex:1" id="res"><h4>Correcteur</h4><div class="muted">Clique sur <b>Corriger</b> : ton programme est exécuté sur ${ex.tests.length} tests cachés${TOOLS[lang] ? "" : " (outil absent sur ce PC : vérification statique du code)"}.</div></div></div></div>`;
    const ed = await mkEditor($("#edh"), saved == null ? ex.starter : saved, lang);
    ed.onDidChangeModelContent(() => ls.set("acad.code." + k, ed.getValue()));
    let hi = 0;
    $("#b-hint").onclick = () => { const h = ex.hints || ["Relis l'énoncé et teste avec un petit exemple à la main."]; $("#hint").innerHTML = "💡 " + md(h[Math.min(hi, h.length - 1)]); hi++; };
    $("#b-reset").onclick = () => ed.setValue(ex.starter);
    $("#b-sol").onclick = () => { if (confirm("Voir la solution ? Réessaie d'abord : l'XP de l'exercice sera réduite.")) { ed.setValue(ex.solution); P.peek = P.peek || {}; P.peek[k] = 1; save(); } };
    $("#b-code").onclick = () => toVSCode(ed.getValue(), les.id);
    $("#b-grade").onclick = async () => {
      const res = $("#res"), code = ed.getValue(); res.innerHTML = '<h4>Correcteur</h4><div class="muted">Exécution des tests…</div>';
      const norm = (s) => String(s || "").replace(/\r/g, "").split("\n").map((x) => x.replace(/\s+$/, "")).join("\n").trim();
      let html = "", pass = 0, ran = 0, compErr = "";
      const miss = (ex.checks || []).filter((c) => !new RegExp(c[0], "m").test(code));
      if (TOOLS[lang]) {
        for (const t of ex.tests) {
          const r = await runCode(lang, code, t.in);
          if (r.phase === "compile" || r.phase === "setup") { compErr = r.stderr; break; }
          ran++; const good = r.ok && norm(r.stdout) === norm(t.out); if (good) pass++;
          html += `<div class="test ${good ? "ok" : "ko"}"><b>${good ? "✓" : "✗"}</b><div>${t.in ? `entrée : <code>${esc(t.in.replace(/\n/g, "↵"))}</code><br>` : ""}attendu : <code>${esc(norm(t.out).replace(/\n/g, "↵"))}</code>${good ? "" : `<pre>obtenu : ${esc(norm(r.stdout).replace(/\n/g, "↵") || "(rien)")}${r.stderr ? "\n" + esc(r.stderr.slice(0, 300)) : ""}</pre>`}</div></div>`;
        }
      }
      const all = !compErr && ran > 0 && pass === ran, stat = !TOOLS[lang] && !miss.length;
      let head;
      if (compErr) head = `<div class="grade ko">✗ Erreur de compilation</div><div class="pre">${esc(compErr)}</div>`;
      else if (!TOOLS[lang]) head = `<div class="grade ${miss.length ? "ko" : "ok"}">${miss.length ? "✗ Il manque des éléments attendus" : "✓ Structure correcte (vérification statique)"}</div><div class="muted">Installe l'outil du langage pour une correction par exécution réelle.</div>`;
      else head = `<div class="grade ${all && !miss.length ? "ok" : "ko"}">${all && !miss.length ? "🎉 Tous les tests passent !" : `${pass}/${ran} tests passés`}</div>`;
      if (miss.length) head += `<div class="test ko"><b>✗</b><div>Ton code doit utiliser : ${miss.map((c) => `<code>${esc(c[1])}</code>`).join(", ")}</div></div>`;
      res.innerHTML = `<h4>Correcteur</h4>${head}${html}`;
      if ((all || stat) && !miss.length && !P.ex[k]) { P.ex[k] = 1; P.done[k] = 1; const base = 20 + les.lv * 5; addXP(P.peek && P.peek[k] ? Math.round(base / 3) : stat ? Math.round(base / 2) : base, "exercice réussi"); confetti(); renderSide(); }
    };
  }
  // ------------------------------------------------------------------ QUIZ
  function lessonQuiz(les, host) { host.innerHTML = `<div class="scroll" id="qz"></div>`; quizRun($("#qz"), les.quiz.map((q) => Object.assign({}, q, { l: lang })), 0); }
  function quizRun(host, qs, n) {
    if (n >= qs.length) { host.innerHTML = `<div class="card"><h2>Série terminée 🎯</h2><button class="btn pri" id="again">Rejouer</button></div>`; $("#again").onclick = () => quizRun(host, qs.slice().sort(() => Math.random() - .5), 0); return; }
    const q = qs[n];
    host.innerHTML = `<div class="card"><div class="muted">Question ${n + 1}/${qs.length} · ${esc((A.langs.find((l) => l.id === q.l) || {}).n || "")}</div><h3>${esc(q.q || "Qu'affiche ce programme ?")}</h3><div class="pre">${esc(q.code)}</div>${q.o.map((o, i) => `<button class="opt" data-i="${i}">${esc(o)}</button>`).join("")}<div id="exp" class="md" style="margin-top:8px"></div><div id="nx"></div></div>`;
    $$(".opt", host).forEach((b) => (b.onclick = () => {
      if ($(".opt.good", host)) return; const ok = +b.dataset.i === q.a;
      b.classList.add(ok ? "good" : "bad"); $$(".opt", host)[q.a].classList.add("good");
      $("#exp", host).innerHTML = md((ok ? "✅ **Exact !** " : "❌ **Pas tout à fait.** ") + (q.why || ""));
      if (ok) { P.quiz++; addXP(4, "bonne prédiction"); }
      $("#nx", host).innerHTML = `<button class="btn pri" style="margin-top:10px">Suivant →</button>`; $("#nx button", host).onclick = () => quizRun(host, qs, n + 1);
    }));
  }
  function quizView() {
    const all = []; Object.keys(A.lessons).forEach((lg) => A.lessons[lg].forEach((x) => (x.quiz || []).forEach((q) => all.push(Object.assign({}, q, { l: lg })))));
    const mine = all.filter((q) => q.l === lang), qs = (mine.length ? mine : all).sort(() => Math.random() - .5);
    $("#work").innerHTML = `<div class="scroll" id="qz"></div>`; if (!qs.length) $("#qz").innerHTML = `<div class="card">Aucune question pour l'instant.</div>`; else quizRun($("#qz"), qs, 0);
  }
  // ------------------------------------------------------------------ ATELIER (Monaco + exécution + trace)
  let labEd = null;
  async function labView() {
    const l = A.langs.find((x) => x.id === lang), tpl = A.templates && A.templates[lang] ? A.templates[lang][0].code : "";
    const code0 = ls.get("acad.lab." + lang, tpl);
    $("#work").innerHTML = `<div class="lesson"><div class="tabs"><button class="on">${l.ic} main.${l.ext}</button><span class="grow"></span></div>
      <div class="lbody" style="flex:1;grid-template-rows:minmax(0,1fr) 170px"><div class="ed"><div class="edhost" id="edh"></div><div class="ctl"><button class="btn pri" id="b-run">▶ Exécuter</button><button class="btn" id="b-trace" title="Anime ton code Python ligne par ligne (trace réelle)">🎬 Visualiser${lang === "python" ? "" : " (Python)"}</button><button class="btn" id="b-code">Ouvrir dans VS Code</button><span class="grow"></span><input id="stdin" placeholder="entrée standard (stdin)" style="background:var(--bg3);border:1px solid var(--line);border-radius:7px;color:var(--tx);padding:5px 8px;width:200px"></div></div>
      <div class="panel" id="say"><h4>Visualisation</h4><div class="muted">Clique sur 🎬 pour animer ton code Python : lignes, variables, pile, sortie.</div></div><div class="term" id="out"><span class="dim">$ </span><span class="cur"></span></div></div></div>`;
    labEd = await mkEditor($("#edh"), code0, lang); labEd.onDidChangeModelContent(() => ls.set("acad.lab." + lang, labEd.getValue()));
    labEd.addCommand(window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.Enter, () => $("#b-run").click());
    $("#b-run").onclick = async () => { const o = $("#out"); o.innerHTML = '<span class="dim">exécution…</span>'; o.innerHTML = fmtRun(await runCode(lang, labEd.getValue(), $("#stdin").value.replace(/\\n/g, "\n"))); };
    $("#b-code").onclick = () => toVSCode(labEd.getValue(), "atelier");
    $("#b-trace").onclick = async () => {
      if (MOBILE) return toast("La trace de TON code Python est disponible sur PC. Ici, les cours restent animés.");
      if (lang !== "python") return toast("La trace réelle est disponible pour Python. Pour les autres langages, ouvre un cours : l'animation y est pré-écrite.");
      const say = $("#say"); say.innerHTML = '<h4>Visualisation</h4><div class="muted">Trace en cours…</div>';
      let r; try { r = await api("/api/academy/trace", { code: labEd.getValue() }); } catch (e) { r = { ok: false, error: e.message }; }
      if (!r.ok) { say.innerHTML = `<h4>Visualisation</h4><div class="err" style="color:var(--bad)">${esc(r.error)}</div>`; return; }
      const steps = r.steps.map((s) => { const fr = s.f; return { l: s.l, t: `Ligne **${s.l}** : ${s.ev === "return" ? "retour de la fonction" : "exécution"}.`, f: fr, o: "", out: s.o, ret: s.ret }; });
      traceMount(steps, r);
    };
  }
  function traceMount(steps, r) {
    const say = $("#say"); stopPlay();
    say.innerHTML = `<h4>Visualisation · ${steps.length} étapes${r.error ? ` · <span style="color:var(--bad)">${esc(r.error)}</span>` : ""}</h4><div class="row"><button class="btn sm" id="t-prev">⏮</button><button class="btn sm pri" id="t-play">▶</button><button class="btn sm" id="t-next">⏭</button><input type="range" id="t-sl" min="0" max="${steps.length - 1}" value="0" style="flex:1;accent-color:var(--acc)"><span id="t-no" class="muted"></span></div><div id="t-mem" style="margin-top:8px"></div>`;
    const show = (i) => {
      i = Math.max(0, Math.min(steps.length - 1, i)); $("#t-sl").value = i; $("#t-no").textContent = `${i + 1}/${steps.length}`; PL.i = i;
      const s = steps[i], sn = { frames: s.f.map((f) => ({ n: f.fn, v: Object.fromEntries(Object.entries(f.vars).filter(([, v]) => !(typeof v === "string" && v.charAt(0) === "ƒ"))) })), heap: {}, before: i ? steps[i - 1].f.map((f) => f.vars) : [], s };
      $("#t-mem").innerHTML = memHTML(sn);
      $("#out").innerHTML = `<span class="dim">$ </span>${esc(s.out)}<span class="cur"></span>`;
      const m = window.monaco; labEd.deltaDecorations(PL.deco, []); PL.deco = labEd.deltaDecorations([], [{ range: new m.Range(s.l, 1, s.l, 1), options: { isWholeLine: true, className: "hl-line", glyphMarginClassName: "hl-glyph" } }]); labEd.revealLineInCenterIfOutsideViewport(s.l);
    };
    $("#t-sl").oninput = (e) => { stopPlay(); show(+e.target.value); };
    $("#t-prev").onclick = () => { stopPlay(); show(PL.i - 1); }; $("#t-next").onclick = () => { stopPlay(); show(PL.i + 1); };
    $("#t-play").onclick = () => { if (PL.t) { stopPlay(); $("#t-play").textContent = "▶"; return; } $("#t-play").textContent = "⏸"; if (PL.i >= steps.length - 1) show(0); PL.t = setInterval(() => { if (PL.i >= steps.length - 1) { stopPlay(); $("#t-play").textContent = "▶"; return; } show(PL.i + 1); }, 900 / CFG.speed); };
    PL.i = 0; show(0);
  }
  // ------------------------------------------------------------------ COMPILATION animée
  const CP = { s: -1, t: 0, busy: false };
  function compileView() {
    const c = A.compile[lang], w = $("#work");
    if (!c) { w.innerHTML = `<div class="scroll"><div class="card">Animation à venir pour ce langage.</div></div>`; return; }
    CP.s = -1; CP.busy = false;
    w.innerHTML = `<div class="scroll"><div class="card"><h2>${esc(c.title)}</h2><p class="muted">${esc(c.intro)}</p><div class="pre" style="max-height:200px">${esc(c.src)}</div>
      <div class="row"><button class="btn pri" id="c-go">▶ Lancer la compilation animée</button><button class="btn" id="c-prev">⏮</button><button class="btn" id="c-next">⏭ Étape suivante</button></div></div>
      <div class="card"><div class="pipe" id="pipe">${c.stages.map((s, i) => `<div class="node" data-i="${i}"><span class="ic">${s.ic}</span><b>${esc(s.n)}</b><small>${esc(s.sub)}</small></div>${i < c.stages.length - 1 ? `<div class="link" id="lk${i}"></div>` : ""}`).join("")}</div>
      <div id="cdet"><p class="muted">Clique sur une étape ou lance l'animation : tu verras ce que chaque outil reçoit, ce qu'il produit, et pourquoi il existe.</p></div></div>
      ${c.extra ? `<div class="card md">${md(c.extra)}</div>` : ""}</div>`;
    const go = async (i) => {
      CP.s = i; const st = c.stages[i];
      $$(".node").forEach((n, k) => { n.classList.toggle("on", k === i); n.classList.toggle("past", k < i); });
      $$(".link").forEach((l, k) => { l.classList.toggle("fill", k < i); l.innerHTML = k === i - 1 && CFG.anim ? '<i class="pkt"></i>' : ""; });
      $("#cdet").innerHTML = `<div class="type-in"><h3 style="margin:6px 0">${st.ic} ${esc(st.n)} <span class="muted" style="font-weight:400">— ${esc(st.sub)}</span></h3>
        <div class="tags"><span class="tag why">À quoi ça sert : ${esc(st.why)}</span></div>${st.cmd ? `<div class="pre" style="margin:6px 0">$ ${esc(st.cmd)}</div>` : ""}
        <div class="xform"><div class="pre"><h5>Entrée · ${esc(st.inL)}</h5>${esc(st.inT)}</div><div class="arrow">➜</div><div class="pre type-in" style="animation-delay:.5s"><h5>Sortie · ${esc(st.outL)}</h5>${esc(st.outT)}</div></div>
        <div class="md" style="margin-top:8px">${md(st.when)}</div></div>`;
      if (i === c.stages.length - 1 && !CP.counted) { CP.counted = true; P.comp++; save(); addXP(8, "compilation comprise"); }
    };
    $$(".node").forEach((n) => (n.onclick = () => { CP.busy = false; go(+n.dataset.i); }));
    $("#c-next").onclick = () => go(Math.min(c.stages.length - 1, CP.s + 1)); $("#c-prev").onclick = () => go(Math.max(0, CP.s - 1));
    $("#c-go").onclick = async () => { if (CP.busy) return; CP.busy = true; CP.counted = false; for (let i = 0; i < c.stages.length && CP.busy; i++) { go(i); await sleep(2800 / CFG.speed); } CP.busy = false; };
  }
  // ------------------------------------------------------------------ SUCCES
  function statsView() {
    const s = stats(), r = rankOf(P.xp);
    $("#work").innerHTML = `<div class="scroll"><div class="card"><h2>🎖️ ${esc(r.n)} · ${P.xp} XP</h2><div class="bar" style="width:100%;height:9px"><i style="width:${Math.round(r.pct * 100)}%"></i></div><p class="muted">${s.done} leçons · ${s.ex} exercices · ${s.quiz} prédictions · série ${P.streak} j</p></div>
      <div class="card"><h3>Par langage</h3>${A.langs.map((l) => { const tot = A.lessons[l.id].length, d = A.lessons[l.id].filter((x) => P.done[l.id + ":" + x.id]).length; return `<div class="row" style="margin:6px 0"><span style="width:110px">${l.ic} ${l.n}</span><div class="bar" style="flex:1;width:auto"><i style="width:${tot ? Math.round(d / tot * 100) : 0}%"></i></div><span class="muted">${d}/${tot}</span></div>`; }).join("")}</div>
      <div class="grid">${A.badges.map((b) => `<div class="badge ${b.f(s) ? "" : "off"}"><span class="e">${b.e}</span><div><b>${esc(b.n)}</b><br><span class="muted">${esc(b.d)}</span></div></div>`).join("")}</div></div>`;
  }
  // ------------------------------------------------------------------ réglages
  function settings() {
    const m = $("#modal");
    m.hidden = false;
    m.innerHTML = `<div class="box"><h2 style="margin-top:0">⚙ Réglages</h2>
      <label>Vitesse des animations<select id="s-sp">${[.5, .75, 1, 1.5, 2, 3].map((v) => `<option ${v === CFG.speed ? "selected" : ""} value="${v}">×${v}</option>`).join("")}</select></label>
      <label>Thème de l'éditeur<select id="s-th">${[["acad", "Néon ENOS"], ["vs-dark", "VS Code sombre"], ["hc-black", "Contraste élevé"], ["vs", "Clair"]].map(([v, n]) => `<option ${v === CFG.theme ? "selected" : ""} value="${v}">${n}</option>`).join("")}</select></label>
      <label>Taille de police<input id="s-fs" type="number" min="10" max="26" value="${CFG.font}"></label>
      <label>Minimap<input id="s-mm" type="checkbox" ${CFG.minimap ? "checked" : ""}></label>
      <label>Ligatures de police<input id="s-lg" type="checkbox" ${CFG.ligatures ? "checked" : ""}></label>
      <label>Effets (confettis, flashs, paquets)<input id="s-an" type="checkbox" ${CFG.anim ? "checked" : ""}></label>
      <label>Lecture automatique des cours<input id="s-au" type="checkbox" ${CFG.auto ? "checked" : ""}></label>
      <div class="row" style="justify-content:space-between;margin-top:14px"><button class="btn sm" id="s-reset">Réinitialiser la progression</button><button class="btn pri" id="s-ok">OK</button></div></div>`;
    $("#s-ok").onclick = () => {
      CFG.speed = +$("#s-sp").value; CFG.theme = $("#s-th").value; CFG.font = +$("#s-fs").value || 14; CFG.minimap = $("#s-mm").checked; CFG.ligatures = $("#s-lg").checked; CFG.anim = $("#s-an").checked; CFG.auto = $("#s-au").checked;
      save(); m.hidden = true; header(); if (window.monaco) { window.monaco.editor.setTheme(CFG.theme); editors.forEach((e) => e.updateOptions({ fontSize: CFG.font, minimap: { enabled: CFG.minimap }, fontLigatures: CFG.ligatures })); }
    };
    $("#s-reset").onclick = () => { if (confirm("Effacer toute ta progression ?")) { try { localStorage.clear(); } catch (e) { /* ignoré */ } location.reload(); } };
    m.onclick = (e) => { if (e.target === m) m.hidden = true; };
  }
  // ------------------------------------------------------------------ démarrage
  document.addEventListener("keydown", (e) => {
    if (view !== "learn" || !PL.st || !$("#b-play") || /INPUT|TEXTAREA/.test((e.target || {}).tagName) || (e.target.closest && e.target.closest(".monaco-editor"))) return;
    if (e.key === "ArrowRight") { stopPlay(); goStep(PL.i + 1); } else if (e.key === "ArrowLeft") { stopPlay(); goStep(PL.i - 1); } else if (e.key === " ") { e.preventDefault(); play(); }
  });
  $("#act").onclick = (e) => { const b = e.target.closest("button[data-v]"); if (!b) return; if (b.dataset.v === "learn" && view === "learn") cur = null; setView(b.dataset.v); };
  $("#b-set").onclick = settings;
  if (par) { const c = $("#close"); c.hidden = false; c.onclick = () => par.postMessage({ enos: "learn-close" }, "*"); }
  header(); renderLangs(); loadTools(); setView("learn");
  // lien direct : #python/func (ou #c/ptr/exercice)
  { const h = location.hash.slice(1).split("/"); const i = h[0] && A.lessons[h[0]] ? A.lessons[h[0]].findIndex((x) => x.id === h[1]) : -1; if (i >= 0) { lang = h[0]; P.lang = lang; renderLangs(); openLesson(i); if (h[2]) { PL.tab = h[2]; lessonView(); } } }
  window.ACADEMY = { P, api, runCode };
})();
