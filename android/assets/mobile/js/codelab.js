"use strict";
// ENOS CodeLab — éditeur de code tactile (CodeMirror 6), « Smart Toolbar » au-dessus du clavier, terminal à tirer vers le haut, quêtes avec ETO.
//   HTML / CSS / JS : exécutés sur le téléphone (aperçu dans une activité Android séparée SANS pont natif ; JS dans un Worker avec délai).
//   C / C++ / Java / Python / SQL / Shell : envoyés au serveur Dual Pulse (/launcher/v1/codelab/run, bac à sable) via le pont natif « cloud ».
// Les projets sont enregistrés sur le téléphone (localStorage) ; rien n'est envoyé au serveur sauf le code qu'on exécute (et, pour un indice d'ETO, le code de la quête à Groq).
(() => {
  const E = window.ENOS, N = E.native, CL = (E.codelab = E.codelab || {}), Q = CL.quest;
  const esc = E.esc;
  const S = E.settings;

  // ------------------------------------------------------------------ langages
  const L = {
    python: { label: "Python", short: "Py", color: "#4b8bbe", file: "main.py", cm: "python", run: "cloud", tpl: 'print("Bonjour CodeLab !")\n' },
    js: { label: "JavaScript", short: "JS", color: "#f0db4f", file: "script.js", cm: "js", run: "worker", tpl: 'console.log("Bonjour CodeLab !");\n' },
    web: { label: "Web · HTML CSS JS", short: "</>", color: "#ff6b3d", file: "index.html", cm: "html", run: "preview", tpl: "" },
    c: { label: "C", short: "C", color: "#6b9bd2", file: "main.c", cm: "c", run: "cloud", tpl: '#include <stdio.h>\n\nint main(void) {\n    printf("Bonjour CodeLab !\\n");\n    return 0;\n}\n' },
    cpp: { label: "C++", short: "C++", color: "#e0629a", file: "main.cpp", cm: "cpp", run: "cloud", tpl: '#include <iostream>\n\nint main() {\n    std::cout << "Bonjour CodeLab !" << std::endl;\n    return 0;\n}\n' },
    java: { label: "Java", short: "Jv", color: "#ef8b3c", file: "Main.java", cm: "java", run: "cloud", tpl: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Bonjour CodeLab !");\n    }\n}\n' },
    sql: { label: "SQL", short: "SQL", color: "#45c4a0", file: "query.sql", cm: "sql", run: "cloud", tpl: "CREATE TABLE heros (nom TEXT, niveau INTEGER);\nINSERT INTO heros VALUES ('Eto', 7), ('Enos', 9);\nSELECT * FROM heros ORDER BY niveau DESC;\n" },
    shell: { label: "Shell (bash)", short: "sh", color: "#9bd35a", file: "script.sh", cm: "shell", run: "cloud", tpl: 'echo "Bonjour CodeLab !"\nfor i in 1 2 3; do echo "ligne $i"; done\n' },
  };
  const WEB_FILES = [
    { n: "index.html", cm: "html", code: '<!doctype html>\n<html lang="fr">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Ma page</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Bonjour CodeLab !</h1>\n  <button id="b">Touche-moi</button>\n  <script src="script.js"></script>\n</body>\n</html>\n' },
    { n: "style.css", cm: "css", code: "body {\n  font-family: system-ui, sans-serif;\n  background: #111;\n  color: #fff;\n  display: grid;\n  place-items: center;\n  min-height: 100vh;\n  margin: 0;\n}\nbutton {\n  padding: 12px 20px;\n  border: 0;\n  border-radius: 12px;\n  background: #e0243c;\n  color: #fff;\n  font-size: 18px;\n}\n" },
    { n: "script.js", cm: "js", code: 'document.getElementById("b").onclick = () => {\n  document.body.style.background = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");\n  console.log("clic !");\n};\n' },
  ];
  const THEMES = { coreboard: "Coreboard (suit ta couleur)", midnight: "Minuit", aurora: "Aurore", matrix: "Matrix", paper: "Papier (clair)" };
  const KEYS_BASE = [
    { l: "⇥", id: "tab", w: 1.25 }, { l: "{ }", pair: ["{", "}"] }, { l: "[ ]", pair: ["[", "]"] }, { l: "( )", pair: ["(", ")"] }, { l: "< >", pair: ["<", ">"] },
    { l: ";", ins: ";" }, { l: "/", ins: "/" }, { l: "←", mv: -1, rep: 1 }, { l: "→", mv: 1, rep: 1 }, { l: "↑", ln: -1, rep: 1 }, { l: "↓", ln: 1, rep: 1 },
  ];
  const KEYS_MORE = {
    python: [":", "#", "_", "=", '"', "'", ".", ",", "*", "+", "-", "%", "!", "&", "|", "\\", "@"],
    js: ["=", ">", '"', "'", "`", ".", ",", ":", "!", "&", "|", "$", "_", "?", "+", "-", "*"],
    html: ["=", '"', "'", "/", "!", "#", ".", ":", "-", "_", "&", ";"],
    css: [":", "#", ".", "%", "-", "!", "@", ",", '"', "'", "*", ">", "+"],
    c: ["#", "=", '"', "'", "*", "&", "|", "!", "%", ".", ",", ":", "+", "-", "\\", "_"],
    sql: ["*", ",", "=", "'", '"', ".", "%", "_", "(", ")", "<", ">", "-"],
    shell: ["$", "|", "&", ">", "<", "#", "=", '"', "'", "*", "~", "-", "_", ".", "\\", "!"],
  };
  KEYS_MORE.cpp = KEYS_MORE.java = KEYS_MORE.c;

  // ------------------------------------------------------------------ état
  const ST = { projects: E.store.get("codelab.projects", []), proj: null, file: 0, ed: null, root: null, lines: [], running: false, hints: 0, tries: 0, last: null, quest: null, data: null, sheet: "closed", tab: "out", vibrate: S.get("cl.haptic", true) };
  const $ = (s, r) => (r || ST.root).querySelector(s);
  const toast = (m, k) => E.ui && E.ui.toast(m, k);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const saveAll = () => E.store.set("codelab.projects", ST.projects.slice(0, 60));
  let saveTimer = 0;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { flushEditor(); saveAll(); const m = $("#cl-meta"); if (m) m.textContent = metaText(); }, 500); };
  const buzz = (ms) => { if (ST.vibrate) try { navigator.vibrate && navigator.vibrate(ms || 8); } catch (e) { /* non disponible */ } };
  const opt = (k, d) => S.get("cl." + k, d);

  function newProject(lang, o) {
    o = o || {};
    const m = L[lang];
    const files = lang === "web" ? WEB_FILES.map((f) => ({ ...f })) : [{ n: m.file, cm: m.cm, code: o.code != null ? o.code : m.tpl }];
    const p = { id: uid(), name: o.name || (lang === "web" ? "Page web" : "Sans titre"), lang, files, stdin: "", quest: o.quest || null, updated: Date.now() };
    ST.projects.unshift(p); saveAll();
    return p;
  }
  const metaText = () => (ST.proj ? L[ST.proj.lang].label + " · enregistré" : "");
  function flushEditor() {
    if (ST.proj && ST.ed) { const f = ST.proj.files[ST.file]; if (f) { f.code = ST.ed.getDoc(); ST.proj.updated = Date.now(); } }
  }

  // ------------------------------------------------------------------ squelette de l'interface
  const ICON = {
    back: '<path d="M15 5l-7 7 7 7"/>', play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>', more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', plus: '<path d="M12 5v14M5 12h14"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>', flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z"/>',
    code: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>', target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k] || ""}</svg>`;

  function mount() {
    if (ST.root) return;
    const r = document.createElement("div");
    r.className = "cl-app"; r.hidden = true; r.setAttribute("data-cl-theme", opt("theme", "coreboard"));
    r.innerHTML = `
      <div class="cl-home" id="cl-home"></div>
      <div class="cl-edit" id="cl-edit" hidden>
        <header class="cl-top">
          <button class="cl-ib" data-a="back" aria-label="Retour">${svg("back")}</button>
          <div class="cl-title"><b id="cl-name"></b><small id="cl-meta"></small></div>
          <button class="cl-ib cl-check" data-a="check" aria-label="Valider la quête" hidden>${svg("check")}</button>
          <button class="cl-run" data-a="run" aria-label="Exécuter">${svg("play")}<span>LANCER</span></button>
          <button class="cl-ib" data-a="menu" aria-label="Menu">${svg("more")}</button>
        </header>
        <div class="cl-ftabs" id="cl-ftabs" hidden></div>
        <div class="cl-ed" id="cl-ed"><div class="cl-boot">Chargement de l'éditeur…</div></div>
        <section class="cl-sheet" id="cl-sheet" data-s="closed">
          <div class="cl-grab" id="cl-grab">
            <i class="cl-pill"></i>
            <div class="cl-stabs" role="tablist">
              <button data-t="out" class="on">SORTIE</button><button data-t="in">ENTRÉE</button><button data-t="eto" id="cl-tab-eto" hidden>ETO<em></em></button>
              <span class="cl-stat" id="cl-stat">Terminal</span>
              <button class="cl-sb" data-a="clear" aria-label="Effacer">${svg("trash")}</button><button class="cl-sb" data-a="copyout" aria-label="Copier">${svg("copy")}</button>
            </div>
          </div>
          <div class="cl-sbody">
            <pre class="cl-term" id="cl-term" data-p="out"></pre>
            <div class="cl-pane" data-p="in" hidden><label>Entrée standard (stdin) fournie au programme</label><textarea id="cl-stdin" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="Une ligne par valeur lue (input(), scanf, Scanner…)"></textarea></div>
            <div class="cl-pane cl-eto" data-p="eto" hidden id="cl-eto"></div>
          </div>
        </section>
        <nav class="cl-kb" id="cl-kb" aria-label="Raccourcis de code"></nav>
      </div>`;
    document.body.appendChild(r);
    ST.root = r;
    r.addEventListener("click", onClick);
    $("#cl-stdin").addEventListener("input", () => { if (ST.proj) { ST.proj.stdin = $("#cl-stdin").value; saveSoon(); } });
    $("#cl-sheet").querySelectorAll(".cl-stabs [data-t]").forEach((b) => b.addEventListener("click", () => tab(b.dataset.t)));
    bindSheet(); bindKeyboard();
    const vv = window.visualViewport;
    const kb = () => { const h = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0; r.style.setProperty("--kb", h + "px"); r.classList.toggle("kb-up", h > 80); };
    if (vv) { vv.addEventListener("resize", kb); vv.addEventListener("scroll", kb); }
    window.addEventListener("resize", kb); kb();
  }

  function onClick(ev) {
    const t = ev.target.closest("[data-a]");
    if (!t || !ST.root.contains(t)) return;
    const a = t.dataset.a;
    ({
      back: () => (view() === "edit" ? goHome() : CL.close()), run: runCurrent, check: checkQuest, menu: openMenu, clear: () => { ST.lines = []; renderTerm(); },
      copyout: () => E.suite.api.copy(ST.lines.map((l) => l.t).join("")),
    }[a] || (() => {}))(t);
  }
  const view = () => (!$("#cl-edit").hidden ? "edit" : "home");

  // ------------------------------------------------------------------ chargement de l'éditeur CodeMirror (à la demande)
  async function ensureEditor() {
    if (ST.ed) return ST.ed;
    await E.suite.api.lib("codemirror");
    const host = $("#cl-ed"); host.innerHTML = "";
    ST.ed = window.CM.create(host, { doc: "", lang: "text", onChange: saveSoon, onSelection: () => updateKeys() });
    applyOptions();
    pinch(host);
    host.addEventListener("focusin", () => ST.root.classList.add("kb-on"));
    host.addEventListener("focusout", () => setTimeout(() => { if (!host.contains(document.activeElement) && !$("#cl-kb").matches(":active")) ST.root.classList.remove("kb-on"); }, 120));
    return ST.ed;
  }
  function applyOptions() {
    const r = ST.root, ed = ST.ed;
    r.setAttribute("data-cl-theme", opt("theme", "coreboard"));
    r.style.setProperty("--cl-fs", opt("fs", 15) + "px");
    if (ed) { ed.setWrap(opt("wrap", false)); ed.setLineNumbers(opt("ln", true)); ed.setAutocomplete(opt("ac", false)); ed.setIndent(opt("tab", 4)); }
  }
  // pincement à deux doigts = taille du texte
  function pinch(host) {
    let d0 = 0, fs0 = 15;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    host.addEventListener("touchstart", (e) => { if (e.touches.length === 2) { d0 = dist(e.touches); fs0 = opt("fs", 15); } }, { passive: true });
    host.addEventListener("touchmove", (e) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      const fs = Math.max(10, Math.min(26, Math.round(fs0 * dist(e.touches) / d0)));
      if (fs !== opt("fs", 15)) { S.set("cl.fs", fs); ST.root.style.setProperty("--cl-fs", fs + "px"); }
    }, { passive: false });
    host.addEventListener("touchend", () => { d0 = 0; }, { passive: true });
  }

  // ------------------------------------------------------------------ Smart Toolbar (au-dessus du clavier)
  function bindKeyboard() {
    const kb = $("#cl-kb");
    // un bouton de la barre ne doit JAMAIS voler le focus de l'éditeur, sinon le clavier Android se ferme
    kb.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
    kb.addEventListener("mousedown", (e) => e.preventDefault());
    kb.addEventListener("touchstart", (e) => { if (e.target.closest("button")) e.preventDefault(); }, { passive: false });
    let hold = 0, rep = 0;
    const stop = () => { clearTimeout(hold); clearInterval(rep); hold = rep = 0; };
    kb.addEventListener("pointerup", stop); kb.addEventListener("pointercancel", stop); kb.addEventListener("pointerleave", stop);
    kb.addEventListener("pointerdown", (e) => {
      const b = e.target.closest("button"); if (!b || !ST.ed) return;
      const k = KEYMAP[b.dataset.k]; if (!k) return;
      buzz(6);
      let longDone = false;
      if (k.rep) {
        k.fire(false); hold = setTimeout(() => { rep = setInterval(() => k.fire(false), 65); }, 340);
      } else if (k.pair) {
        hold = setTimeout(() => { longDone = true; buzz(14); k.fire(true); }, 420);
        b.addEventListener("pointerup", function up() { b.removeEventListener("pointerup", up); clearTimeout(hold); if (!longDone) k.fire(false); }, { once: true });
      } else k.fire(false);
    });
  }
  let KEYMAP = {};
  function updateKeys() { /* annuler / refaire : pastilles grisées si rien à faire */
    const ed = ST.ed; if (!ed) return;
    const u = ST.root.querySelector('[data-k="undo"]'), r = ST.root.querySelector('[data-k="redo"]');
    if (u) u.classList.toggle("dim", !ed.canUndo()); if (r) r.classList.toggle("dim", !ed.canRedo());
  }
  function buildKeys() {
    const ed = () => ST.ed, lang = ST.proj ? (ST.proj.lang === "web" ? ST.proj.files[ST.file].cm : ST.proj.lang === "js" ? "js" : ST.proj.lang) : "python";
    KEYMAP = {};
    const defs = [];
    const add = (id, label, o) => { KEYMAP[id] = o; defs.push(`<button type="button" data-k="${id}" class="${o.cls || ""}" style="${o.w ? "flex:" + o.w + " 0 auto" : ""}">${esc(label)}</button>`); };
    KEYS_BASE.forEach((k, i) => {
      const id = "b" + i;
      if (k.id === "tab") add(id, k.l, { cls: "wide acc", fire: () => { const sel = ed().selection(); sel.includes("\n") ? ed().indent() : ed().insert(" ".repeat(opt("tab", 4))); } });
      else if (k.pair) add(id, k.l, { cls: "pair", pair: true, fire: (long) => {
        const [o, c] = k.pair, e = ed(), sel = e.selection();
        if (long) { const n = e.view.state.sliceDoc(e.view.state.selection.main.to, e.view.state.selection.main.to + 1); n === c ? e.move(1) : e.insert(c); return; }
        if (sel) e.wrapSelection(o, c); else e.insert(opt("pairs", true) ? o + c : o, opt("pairs", true) ? 1 : 0);
      } });
      else if (k.ins) add(id, k.l, { fire: () => ed().insert(k.ins) });
      else if (k.mv) add(id, k.l, { cls: "arrow", rep: true, fire: () => ed().move(k.mv) });
      else if (k.ln) add(id, k.l, { cls: "arrow", rep: true, fire: () => ed().moveLine(k.ln) });
    });
    add("outdent", "⇤", { fire: () => ed().outdent() });
    add("undo", "↶", { cls: "acc", fire: () => ed().undo() }); add("redo", "↷", { cls: "acc", fire: () => ed().redo() });
    (KEYS_MORE[lang] || KEYS_MORE.c).forEach((ch, i) => add("m" + i, ch, { fire: () => (ch === '"' || ch === "'" || ch === "`") && opt("pairs", true) && !ed().selection() ? ed().insert(ch + ch, 1) : ed().insert(ch) }));
    $("#cl-kb").innerHTML = `<div class="cl-krow">${defs.join("")}</div>`;
    updateKeys();
  }

  // ------------------------------------------------------------------ terminal à tirer (feuille du bas)
  function bindSheet() {
    const sh = $("#cl-sheet"), grab = $("#cl-grab");
    let y0 = 0, h0 = 0, t0 = 0, drag = false, moved = false, lastY = 0, lastT = 0, v = 0;
    const H = () => $("#cl-edit").clientHeight;
    const snap = { closed: () => 0, half: () => Math.round(H() * 0.42), full: () => Math.round(H() * 0.84) };
    ST.snap = snap;
    grab.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      drag = true; moved = false; y0 = lastY = e.clientY; t0 = lastT = performance.now(); h0 = sh.querySelector(".cl-sbody").getBoundingClientRect().height; v = 0;
      grab.setPointerCapture(e.pointerId); sh.classList.add("drag");
    });
    grab.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dy = y0 - e.clientY; if (Math.abs(dy) > 4) moved = true;
      const now = performance.now(); v = (lastY - e.clientY) / Math.max(1, now - lastT); lastY = e.clientY; lastT = now;
      sh.style.setProperty("--sh", Math.max(0, Math.min(snap.full(), h0 + dy)) + "px");
    });
    const end = (e) => {
      if (!drag) return; drag = false; sh.classList.remove("drag");
      const cur = sh.querySelector(".cl-sbody").getBoundingClientRect().height;
      if (!moved) { setSheet(ST.sheet === "closed" ? "half" : "closed"); return; }
      let target;
      if (Math.abs(v) > 0.45) target = v > 0 ? (cur > snap.half() * 0.8 ? "full" : "half") : (cur < snap.half() * 1.2 ? "closed" : "half");
      else target = [["closed", snap.closed()], ["half", snap.half()], ["full", snap.full()]].sort((a, b) => Math.abs(a[1] - cur) - Math.abs(b[1] - cur))[0][0];
      setSheet(target);
    };
    grab.addEventListener("pointerup", end); grab.addEventListener("pointercancel", end);
    // glisser vers le haut depuis la barre d'outils ouvre aussi le terminal
    const kb = $("#cl-kb"); let ky = 0;
    kb.addEventListener("touchstart", (e) => { ky = e.touches[0].clientY; }, { passive: true });
    kb.addEventListener("touchend", (e) => { const dy = ky - e.changedTouches[0].clientY; if (dy > 46 && ST.sheet === "closed") setSheet("half"); }, { passive: true });
    window.addEventListener("resize", () => setSheet(ST.sheet, true));
  }
  function setSheet(s, quiet) {
    ST.sheet = s; const sh = $("#cl-sheet"); sh.dataset.s = s;
    sh.style.setProperty("--sh", ST.snap[s]() + "px");
    if (!quiet) buzz(5);
  }
  function tab(t) {
    ST.tab = t;
    ST.root.querySelectorAll(".cl-stabs [data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    ST.root.querySelectorAll(".cl-sbody > [data-p]").forEach((p) => { p.hidden = p.dataset.p !== t; });
    if (t === "eto") { const dot = $("#cl-tab-eto em"); if (dot) dot.className = ""; renderEto(); }
    if (ST.sheet === "closed") setSheet("half");
    if (t === "out") { const term = $("#cl-term"); term.scrollTop = term.scrollHeight; }
  }
  const status = (m, cls) => { const s = $("#cl-stat"); if (s) { s.textContent = m; s.className = "cl-stat " + (cls || ""); } };
  function out(kind, text) {
    ST.lines.push({ k: kind, t: text }); if (ST.lines.length > 1500) ST.lines.splice(0, ST.lines.length - 1500);
    const term = $("#cl-term"); if (!term) return;
    const sp = document.createElement("span"); sp.className = "t-" + kind; sp.textContent = text; term.appendChild(sp);
    term.scrollTop = term.scrollHeight;
  }
  function renderTerm() {
    const term = $("#cl-term"); term.textContent = "";
    ST.lines.forEach((l) => { const sp = document.createElement("span"); sp.className = "t-" + l.k; sp.textContent = l.t; term.appendChild(sp); });
  }

  // ------------------------------------------------------------------ exécution
  const JS_WORKER = `
    const post = (t, s) => postMessage({ t, s });
    const show = (v) => { if (typeof v === "string") return v; if (v === undefined) return "undefined"; if (typeof v === "function") return "[Function " + (v.name || "anonyme") + "]"; try { return typeof v === "object" ? JSON.stringify(v, (k, x) => typeof x === "bigint" ? x + "n" : x, 1 < 0 ? 2 : 0) : String(v); } catch (e) { return String(v); } };
    const fmt = (a) => a.map(show).join(" ") + "\\n";
    onmessage = async (ev) => {
      const { code, input } = ev.data;
      console.log = console.info = console.debug = (...a) => post("o", fmt(a));
      console.warn = console.error = (...a) => post("e", fmt(a));
      const q = String(input || "").replace(/\\r/g, "").split("\\n"); if (q.length && q[q.length - 1] === "") q.pop();
      let qi = 0; self.INPUT = input || ""; self.readLine = () => (qi < q.length ? q[qi++] : null); self.prompt = () => self.readLine();
      self.addEventListener("unhandledrejection", (e) => post("e", "Promesse rejetée : " + (e.reason && e.reason.message || e.reason) + "\\n"));
      let fn;
      try { fn = new (Object.getPrototypeOf(async function () {}).constructor)(code); }
      catch (x) { post("e", "Erreur de syntaxe : " + x.message + "\\n"); return post("done", "1"); }
      try { await fn(); setTimeout(() => post("done", "0"), 150); }
      catch (x) { const m = /<anonymous>:(\\d+):(\\d+)/.exec(String(x && x.stack)); post("e", (x && x.name || "Erreur") + " : " + (x && x.message || x) + (m ? " (ligne " + Math.max(1, +m[1] - 2) + ")" : "") + "\\n"); post("done", "1"); }
    };`;
  function runWorker(code, stdin, onOut) {
    return new Promise((resolve) => {
      let w; const t0 = performance.now(); let so = "", se = "", end = false, failed = false;
      const finish = (extra) => { if (end) return; end = true; clearTimeout(kill); try { w.terminate(); } catch (e) { /* déjà arrêté */ } resolve({ ok: !failed && !(extra && extra.timed_out), stdout: so, stderr: se, phase: "run", exit_code: extra && extra.code, duration_ms: Math.round(performance.now() - t0), ...(extra || {}) }); };
      try { w = new Worker(URL.createObjectURL(new Blob([JS_WORKER], { type: "text/javascript" }))); } catch (e) { return resolve({ ok: false, stdout: "", stderr: "Impossible de lancer l'exécuteur JavaScript : " + e.message, phase: "run" }); }
      const kill = setTimeout(() => { se += "⏱ Délai dépassé (6 s) : boucle infinie ?\n"; if (onOut) onOut("e", "⏱ Délai dépassé (6 s) : boucle infinie ?\n"); finish({ timed_out: true, code: null }); }, 6000);
      w.onmessage = (e) => {
        const m = e.data;
        if (m.t === "o") { if (so.length < 200000) so += m.s; if (onOut) onOut("o", m.s); }
        else if (m.t === "e") { if (se.length < 100000) se += m.s; if (onOut) onOut("e", m.s); }
        else if (m.t === "done") { failed = failed || m.s === "1"; finish({ code: +m.s }); }
      };
      w.onerror = (e) => { failed = true; se += (e.message || "Erreur du worker") + "\n"; if (onOut) onOut("e", (e.message || "Erreur") + "\n"); finish({ code: 1 }); };
      w.postMessage({ code, input: stdin });
    });
  }
  const SERVER_LANG = { python: "python", c: "c", cpp: "cpp", java: "java", sql: "sql", shell: "shell" };
  async function cloudRun(lang, code, stdin) {
    if (!E.cloud || !E.cloud.loggedIn()) return { ok: false, stdout: "", stderr: "Ce langage s'exécute sur le serveur Dual Pulse.\nConnecte-toi : Modules → Cloud, puis relance.", phase: "run", needLogin: true };
    const wake = setTimeout(() => out("sys", "… le serveur gratuit se réveille (jusqu'à une minute au premier lancement)\n"), 4500);
    try {
      const r = await E.cloud.req("/codelab/run", { method: "POST", body: { language: SERVER_LANG[lang], code, stdin: stdin || "" } });
      const j = r.json || {};
      if (r.status === 200) return j;
      const why = { 401: "Session cloud expirée : reconnecte-toi.", 429: j.detail || "Trop d'exécutions : attends quelques secondes.", 503: j.detail || "Le bac à sable du serveur n'est pas disponible." }[r.status];
      return { ok: false, stdout: "", stderr: why || (typeof j.detail === "string" ? j.detail : "Erreur " + r.status), phase: "run" };
    } catch (e) {
      return { ok: false, stdout: "", stderr: "Serveur injoignable : " + e.message, phase: "run" };
    } finally { clearTimeout(wake); }
  }

  // assemble les 3 fichiers d'un projet web en un seul document (les <link>/<script> locaux sont remplacés par leur contenu)
  function webDoc(p, shim) {
    const get = (n) => (p.files.find((f) => f.n === n) || { code: "" }).code;
    let html = get("index.html");
    const css = get("style.css"), js = get("script.js").replace(/<\/script/gi, "<\\/script");
    html = html.replace(/<link[^>]+href=["']style\.css["'][^>]*>/gi, "").replace(/<script[^>]+src=["']script\.js["'][^>]*>\s*<\/script>/gi, "");
    const head = (shim || "") + (css.trim() ? `<style>\n${css}\n</style>` : "");
    html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, head + "</head>") : head + html;
    const tail = js.trim() ? `<script>\n${js}\n</script>` : "";
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, tail + "</body>") : html + tail;
    return html;
  }
  const SHIM = `<script>(function(){var p=function(l,a){try{parent.postMessage({cl:1,l:l,s:[].map.call(a,function(x){try{return typeof x==="string"?x:JSON.stringify(x)}catch(e){return String(x)}}).join(" ")},"*")}catch(e){}};["log","info","warn","error"].forEach(function(k){var o=console[k];console[k]=function(){p(k,arguments);o&&o.apply(console,arguments)}});addEventListener("error",function(e){p("error",[e.message+" (ligne "+e.lineno+")"])});addEventListener("unhandledrejection",function(e){p("error",["Promesse rejetée : "+(e.reason&&e.reason.message||e.reason)])})})();<\/script>`;
  function preview() {
    flushEditor();
    const p = ST.proj;
    if (window.Enos && window.Enos.openPreview) {                    // application Android : activité séparée, sans pont natif, réseau coupé
      try { window.Enos.openPreview(webDoc(p, ""), p.name); out("sys", "▶ aperçu ouvert (retour pour revenir à l'éditeur)\n"); return; } catch (e) { /* repli ci-dessous */ }
    }
    const ov = document.createElement("div"); ov.className = "cl-prev";
    ov.innerHTML = `<header><button class="cl-ib" aria-label="Fermer">${svg("back")}</button><b>${esc(p.name)}</b><small>aperçu hors-ligne</small></header><iframe sandbox="allow-scripts allow-forms allow-modals"></iframe>`;
    ST.root.appendChild(ov);
    const fr = ov.querySelector("iframe"); fr.srcdoc = webDoc(p, SHIM);
    const onMsg = (e) => { if (e.source === fr.contentWindow && e.data && e.data.cl) out(e.data.l === "error" ? "e" : "o", "[aperçu] " + e.data.s + "\n"); };
    window.addEventListener("message", onMsg);
    ov.querySelector("button").onclick = () => { window.removeEventListener("message", onMsg); ov.remove(); };
    out("sys", "▶ aperçu\n");
  }
  CL.previewLog = (json) => { try { const m = JSON.parse(json); out(/error|warn/i.test(m.level) ? "e" : "o", "[aperçu] " + m.msg + (m.line ? " (ligne " + m.line + ")" : "") + "\n"); } catch (e) { /* ignoré */ } };

  async function execute(stdinOverride, quiet) {
    flushEditor();
    const p = ST.proj, m = L[p.lang], stdin = stdinOverride != null ? stdinOverride : (p.stdin || "");
    if (m.run === "worker") { const code = p.files[0].code; return runWorker(code, stdin, quiet ? null : (k, s) => out(k === "e" ? "err" : "out", s)); }
    if (m.run === "cloud") return cloudRun(p.lang, p.files[0].code, stdin);
    return { ok: true, stdout: "", stderr: "", phase: "run" };
  }
  async function runCurrent() {
    if (ST.running || !ST.proj) return;
    const p = ST.proj, m = L[p.lang];
    if (m.run === "preview") return preview();
    ST.running = true; setRunning(true);
    ST.lines = []; renderTerm(); tab("out"); if (ST.sheet === "closed") setSheet("half");
    out("sys", `▶ ${m.label}…\n`); status("Exécution…", "busy");
    const r = await execute(null, false);
    if (m.run === "cloud") {
      if (r.stdout) out("out", r.stdout.endsWith("\n") ? r.stdout : r.stdout + "\n");
      if (r.stderr) out("err", r.stderr.endsWith("\n") ? r.stderr : r.stderr + "\n");
      if (r.truncated) out("sys", "… sortie tronquée\n");
    }
    const okRun = r.ok !== false && !r.timed_out;
    out(okRun ? "ok" : "err", (okRun ? "✓ terminé" : r.phase === "compile" ? "✗ erreur de compilation" : r.timed_out ? "✗ délai dépassé" : "✗ échec") + (r.duration_ms != null ? ` · ${r.duration_ms} ms` : "") + (r.exit_code != null ? ` · code ${r.exit_code}` : "") + "\n");
    status(okRun ? "✓ " + (r.duration_ms || 0) + " ms" : "✗ erreur", okRun ? "ok" : "bad");
    ST.last = { stdout: r.stdout, stderr: r.stderr, results: ST.last && ST.last.results };
    ST.running = false; setRunning(false);
    buzz(okRun ? 10 : 30);
  }
  function setRunning(on) { const b = $(".cl-run"); b.classList.toggle("busy", on); b.disabled = on; }

  // ------------------------------------------------------------------ écrans : accueil
  const lvlBar = () => { const xp = Q.xp(), lv = Q.level(xp), p = Q.progress(); return `<div class="cl-lvl"><div class="cl-ring" style="--p:${Math.round(((xp - lv.from) / (lv.to - lv.from)) * 100)}"><b>${lv.n}</b></div><div><b>Niveau ${lv.n}</b><small>${xp} XP · prochain palier ${lv.to}</small></div><div class="cl-streak" title="Jours d'affilée">${svg("flame")}<b>${p.streak || 0}</b></div></div>`; };
  async function renderHome() {
    const h = $("#cl-home"), prog = Q.progress();
    let data = ST.data;
    h.innerHTML = `
      <header class="cl-htop"><button class="cl-ib" data-a="back" aria-label="Fermer">${svg("back")}</button><div><h2>CodeLab</h2><small>code & apprends avec ETO</small></div></header>
      <div class="cl-hscroll">
        ${lvlBar()}
        <section><h3>Nouveau projet</h3><div class="cl-newgrid">${Object.keys(L).map((k) => `<button class="cl-new" data-new="${k}" style="--c:${L[k].color}"><i>${esc(L[k].short)}</i><span>${esc(L[k].label.split(" ·")[0])}</span></button>`).join("")}</div></section>
        <section id="cl-qsec"><h3>Quêtes <small>avec ETO</small></h3><div class="cl-qlangs" id="cl-qlangs"></div><div class="cl-qlist" id="cl-qlist"><div class="cl-note">Chargement des quêtes…</div></div></section>
        <section><h3>Mes projets <small>${ST.projects.length}</small></h3><div class="cl-plist">${ST.projects.length ? ST.projects.map((p) => `<div class="cl-proj" data-open="${p.id}" style="--c:${L[p.lang].color}"><i>${esc(L[p.lang].short)}</i><div><b>${esc(p.name)}</b><small>${esc(L[p.lang].label.split(" ·")[0])}${p.quest ? " · quête" : ""} · ${new Date(p.updated).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</small></div><button class="cl-sb" data-del="${p.id}" aria-label="Supprimer">${svg("trash")}</button></div>`).join("") : '<div class="cl-note">Aucun projet pour l\'instant. Touche un langage ci-dessus pour commencer.</div>'}</div></section>
        <div class="cl-foot"></div>
      </div>`;
    h.onclick = (e) => {
      const n = e.target.closest("[data-new]"), o = e.target.closest("[data-open]"), d = e.target.closest("[data-del]"), ql = e.target.closest("[data-ql]"), q = e.target.closest("[data-quest]");
      if (n) return openNew(n.dataset.new);
      if (d) { e.stopPropagation(); return delProject(d.dataset.del); }
      if (o) return openProject(ST.projects.find((x) => x.id === o.dataset.open));
      if (ql) { ST.qlang = ql.dataset.ql; return drawQuests(); }
      if (q) return openQuest(q.dataset.quest);
      const b = e.target.closest('[data-a="back"]'); if (b) CL.close();
    };
    try { data = ST.data = ST.data || (await Q.load()); } catch (e) { $("#cl-qlist").innerHTML = '<div class="cl-note">Quêtes indisponibles.</div>'; return; }
    ST.qlang = ST.qlang || "python"; drawQuests();
  }
  function drawQuests() {
    const data = ST.data, langs = Object.keys(data.languages || {});
    $("#cl-qlangs").innerHTML = langs.map((k) => { const n = Q.forLang(data, k), d = n.filter((q) => Q.isDone(q.id)).length; return `<button data-ql="${k}" class="${k === ST.qlang ? "on" : ""}" style="--c:${(L[k] || {}).color || "#888"}">${esc(data.languages[k].label)}<small>${d}/${n.length}</small></button>`; }).join("");
    const list = Q.forLang(data, ST.qlang);
    const intro = data.languages[ST.qlang] && data.languages[ST.qlang].intro;
    $("#cl-qlist").innerHTML = (intro ? `<div class="cl-eto-say"><i>ETO</i><p>${esc(intro)}</p></div>` : "") + list.map((q, i) => {
      const done = Q.isDone(q.id), open = Q.unlocked(data, q);
      return `<button class="cl-quest ${done ? "done" : ""} ${open ? "" : "locked"}" data-quest="${q.id}" ${open ? "" : "disabled"} style="--c:${(L[q.lang] || {}).color || "#888"}"><span class="cl-qn">${done ? svg("check") : open ? i + 1 : "🔒"}</span><div><b>${esc(q.title)}</b><small>${esc(q.goal.length > 78 ? q.goal.slice(0, 76) + "…" : q.goal)}</small></div><em>${q.xp} XP</em></button>`;
    }).join("");
  }
  function delProject(id) {
    const p = ST.projects.find((x) => x.id === id); if (!p) return;
    E.ui.confirm("Supprimer ce projet ?", "« " + p.name + " » sera effacé de ce téléphone.", "SUPPRIMER", true).then((ok) => { if (ok) { ST.projects = ST.projects.filter((x) => x.id !== id); saveAll(); renderHome(); } });
  }
  function openNew(lang) { openProject(newProject(lang)); }

  // ------------------------------------------------------------------ écrans : éditeur
  async function openProject(p) {
    if (!p) return;
    mount(); ST.proj = p; ST.file = p.active || 0; ST.hints = 0; ST.tries = 0; ST.last = null; ST.lines = []; renderTerm(); status("Terminal");
    $("#cl-home").hidden = true; $("#cl-edit").hidden = false;
    $("#cl-name").textContent = p.name; $("#cl-meta").textContent = metaText();
    $("#cl-stdin").value = p.stdin || "";
    ST.quest = null; $(".cl-check").hidden = true; $("#cl-tab-eto").hidden = true;
    ftabs();
    setSheet("closed", true); tab("out");
    await ensureEditor();
    loadFile(ST.file);
    buildKeys();
    if (p.quest) {
      try { ST.data = ST.data || (await Q.load()); } catch (e) { /* hors-ligne */ }
      ST.quest = ST.data && ST.data.quests.find((q) => q.id === p.quest);
      if (ST.quest) { $(".cl-check").hidden = false; $("#cl-tab-eto").hidden = false; tab("eto"); setSheet("half"); }
    }
    if (!p.quest) out("sys", "Touche ▶ LANCER. Glisse ce panneau vers le haut pour agrandir le terminal.\n");
  }
  function loadFile(i) {
    const f = ST.proj.files[i]; ST.file = i; ST.proj.active = i;
    ST.ed.setLang(f.cm); ST.ed.setDoc(f.code); applyOptions(); updateKeys();
    ST.root.querySelectorAll("#cl-ftabs button").forEach((b, j) => b.classList.toggle("on", j === i));
    buildKeys();
  }
  function ftabs() {
    const t = $("#cl-ftabs"), p = ST.proj;
    t.hidden = p.files.length < 2;
    t.innerHTML = p.files.map((f, i) => `<button data-f="${i}" class="${i === ST.file ? "on" : ""}">${esc(f.n)}</button>`).join("");
    t.onclick = (e) => { const b = e.target.closest("[data-f]"); if (b) { flushEditor(); loadFile(+b.dataset.f); } };
  }
  function goHome() {
    flushEditor(); saveAll();
    $("#cl-edit").hidden = true; $("#cl-home").hidden = false; ST.root.classList.remove("kb-on");
    ST.proj = null; ST.quest = null; renderHome();
  }

  // ------------------------------------------------------------------ menu ⋯
  function openMenu() {
    const p = ST.proj;
    const row = (id, l, v) => `<button class="cl-mrow" data-m="${id}"><span>${l}</span><em>${v || ""}</em></button>`;
    const body = `<div class="cl-menu">
      ${row("theme", "Thème", THEMES[opt("theme", "coreboard")].split(" (")[0])}${row("fs-", "Texte plus petit", opt("fs", 15) + " px")}${row("fs+", "Texte plus grand")}
      ${row("wrap", "Retour à la ligne", opt("wrap", false) ? "oui" : "non")}${row("ln", "Numéros de ligne", opt("ln", true) ? "oui" : "non")}${row("pairs", "Fermeture auto ( ) { } \" \"", opt("pairs", true) ? "oui" : "non")}
      ${row("ac", "Auto-complétion", opt("ac", false) ? "oui" : "non")}${row("tab", "Indentation", opt("tab", 4) + " espaces")}${row("haptic", "Vibrations", ST.vibrate ? "oui" : "non")}
      ${row("copy", "Copier le code")}${row("save", "Enregistrer dans Téléchargements")}${row("rename", "Renommer le projet")}${row("reset", p.quest ? "Revenir au code de départ" : "Remettre le modèle")}
    </div>`;
    E.ui.sheet({ title: "CodeLab", html: body, onOpen: (el) => {
      const close = () => E.ui.closeSheet();
      el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-m]"); if (!b) return;
        const id = b.dataset.m; let keep = false;
        const tog = (k, d) => S.set("cl." + k, !opt(k, d));
        if (id === "theme") { const ks = Object.keys(THEMES); S.set("cl.theme", ks[(ks.indexOf(opt("theme", "coreboard")) + 1) % ks.length]); keep = true; }
        else if (id === "fs-") { S.set("cl.fs", Math.max(10, opt("fs", 15) - 1)); keep = true; } else if (id === "fs+") { S.set("cl.fs", Math.min(26, opt("fs", 15) + 1)); keep = true; }
        else if (id === "wrap") { tog("wrap", false); keep = true; } else if (id === "ln") { tog("ln", true); keep = true; } else if (id === "pairs") { tog("pairs", true); keep = true; } else if (id === "ac") { tog("ac", false); keep = true; }
        else if (id === "tab") { S.set("cl.tab", opt("tab", 4) === 4 ? 2 : 4); keep = true; } else if (id === "haptic") { ST.vibrate = !ST.vibrate; S.set("cl.haptic", ST.vibrate); keep = true; }
        else if (id === "copy") E.suite.api.copy(ST.ed.getDoc());
        else if (id === "save") { const f = p.files[ST.file]; E.suite.api.save(f.n, "text/plain", new TextEncoder().encode(ST.ed.getDoc()), "downloads"); }
        else if (id === "rename") { setTimeout(rename, 150); }
        else if (id === "reset") { const q = ST.quest; const f = p.files[ST.file]; const tpl = q ? q.starter : p.lang === "web" ? WEB_FILES[ST.file].code : L[p.lang].tpl; f.code = tpl; ST.ed.setDoc(tpl); }
        applyOptions(); buildKeys();
        if (keep) { const r = { theme: THEMES[opt("theme", "coreboard")].split(" (")[0], "fs-": opt("fs", 15) + " px", wrap: opt("wrap", false) ? "oui" : "non", ln: opt("ln", true) ? "oui" : "non", pairs: opt("pairs", true) ? "oui" : "non", ac: opt("ac", false) ? "oui" : "non", tab: opt("tab", 4) + " espaces", haptic: ST.vibrate ? "oui" : "non" }; if (r[id] != null) b.querySelector("em").textContent = r[id]; if (id === "fs+") el.querySelector('[data-m="fs-"] em').textContent = opt("fs", 15) + " px"; } else close();
      });
    } });
  }
  function rename() {
    E.ui.prompt("Nom du projet", "Mon projet", ST.proj.name, "RENOMMER").then((v) => { if (v && v.trim()) { ST.proj.name = v.trim().slice(0, 40); $("#cl-name").textContent = ST.proj.name; saveAll(); } });
  }

  // ------------------------------------------------------------------ quêtes
  async function openQuest(id) {
    const q = ST.data.quests.find((x) => x.id === id); if (!q) return;
    let p = ST.projects.find((x) => x.quest === id);
    if (!p) p = newProject(q.lang, { name: q.title, code: q.starter, quest: id });
    openProject(p);
  }
  function setEtoBadge() { const d = $("#cl-tab-eto em"); if (d) d.className = "ping"; }
  function etoSay(text, kind) {
    const box = $("#cl-eto .cl-chat"); if (!box) return;
    const d = document.createElement("div"); d.className = "cl-eto-say " + (kind || ""); d.innerHTML = "<i>ETO</i><p></p>"; d.querySelector("p").textContent = text; box.appendChild(d);
    const pane = $("#cl-eto"); pane.scrollTop = pane.scrollHeight;
  }
  function renderEto() {
    const q = ST.quest, el = $("#cl-eto"); if (!q) { el.innerHTML = '<div class="cl-note">Ouvre une quête depuis l\'accueil pour qu\'ETO t\'accompagne.</div>'; return; }
    if (el.dataset.q === q.id && el.querySelector(".cl-chat")) return;
    el.dataset.q = q.id;
    el.innerHTML = `<div class="cl-qhead" style="--c:${(L[q.lang] || {}).color}"><div><small>${esc(q.lang.toUpperCase())} · niveau ${q.level} · ${q.xp} XP</small><b>${esc(q.title)}</b></div></div>
      <div class="cl-chat"></div>
      <div class="cl-goal">${svg("target")}<p>${esc(q.goal)}</p></div>
      <div class="cl-tests" id="cl-tests"></div>
      <div class="cl-eacts"><button class="cl-btn ghost" data-e="hint">${svg("bulb")} Un indice <span id="cl-hl">(${ST.hints}/3)</span></button><button class="cl-btn" data-e="check">${svg("check")} Valider</button></div>`;
    etoSay(q.story || "Prêt ? Écris ton code, lance-le, puis valide.");
    el.onclick = (e) => { const b = e.target.closest("[data-e]"); if (!b) return; if (b.dataset.e === "hint") askHint(); else checkQuest(); };
    renderTests(null);
  }
  function renderTests(res) {
    const t = $("#cl-tests"); if (!t || !ST.quest) return;
    t.innerHTML = ST.quest.tests.map((x, i) => { const r = res && res[i]; return `<span class="cl-t ${r ? (r.ok ? "ok" : "bad") : ""}">${r ? (r.ok ? "✓" : "✗") : "○"} test ${i + 1}</span>`; }).join("");
  }
  async function askHint() {
    const q = ST.quest; if (!q || ST.busyHint) return;
    if (ST.hints >= 3) { etoSay("Tu as déjà reçu mes trois chuchotements. Relis-les, un par un, et teste une petite modification.", "dim"); return; }
    ST.busyHint = true; const level = ++ST.hints; $("#cl-hl").textContent = `(${ST.hints}/3)`;
    etoSay("…", "thinking"); flushEditor();
    const last = ST.last, h = await Q.hint(q, { code: ST.proj.files[0].code, last, level });
    const box = $("#cl-eto .cl-chat"); box.lastChild.remove();
    etoSay(h.text, h.source === "eto" ? "" : "author");
    ST.busyHint = false; buzz(12);
  }
  async function checkQuest() {
    const q = ST.quest; if (!q || ST.running) return;
    ST.running = true; setRunning(true); flushEditor(); tab("eto"); if (ST.sheet === "closed") setSheet("half");
    ST.tries++; status("Vérification…", "busy");
    const prog = [];
    const code = ST.proj.files[0].code;
    const res = await Q.check(q, (stdin) => (L[ST.proj.lang].run === "worker" ? runWorker(code, stdin, null) : cloudRun(ST.proj.lang, code, stdin)), (i, n, r) => { prog.push(r); renderTests(prog); status(`Test ${i}/${n}`, "busy"); });
    ST.last = { stdout: (res.results[0] || {}).actual, stderr: (res.results.find((r) => r.stderr) || {}).stderr, results: res.results };
    renderTests(res.results);
    ST.running = false; setRunning(false);
    if (res.pass) return win();
    status("✗ pas encore", "bad"); buzz(30);
    const f = res.results.find((r) => !r.ok);
    if (f && f.phase === "compile") etoSay("Le compilateur n'est pas content. Regarde l'onglet SORTIE : la première erreur dit presque toujours la vérité.", "dim");
    else if (f && f.stderr && /Connecte-toi|serveur/i.test(f.stderr)) etoSay(f.stderr, "dim");
    else if (f && f.timed_out) etoSay("Ton programme tourne sans s'arrêter. Cherche une boucle qui ne se termine jamais.", "dim");
    else etoSay(ST.tries >= 2 ? "Pas encore, mais tu t'en approches. Demande-moi un indice si tu veux." : "Pas tout à fait. Lance ton code et compare sa sortie avec ce qui est attendu.", "dim");
    if (ST.tries >= 2) setEtoBadge();
    if (f && f.stderr && f.phase !== "compile") { ST.lines = []; renderTerm(); out("err", f.stderr); }
  }
  function win() {
    const q = ST.quest, r = Q.complete(q, { hints: ST.hints, tries: ST.tries });
    status("✓ quête réussie", "ok"); buzz(40);
    const nxt = Q.next(ST.data, q);
    const w = document.createElement("div"); w.className = "cl-win";
    w.innerHTML = `<div class="cl-wcard"><div class="cl-burst">${Array.from({ length: 18 }, (_, i) => `<i style="--a:${i * 20}deg;--d:${0.55 + (i % 5) * 0.12}s"></i>`).join("")}</div>
      <h2>Quête réussie !</h2><p class="cl-wq">${esc(q.title)}</p>
      <div class="cl-xp">${r.first ? "+" + r.gained + " XP" : "déjà accomplie"}</div>
      <div class="cl-lvl big">${lvlBar().replace(/^<div class="cl-lvl">/, "").replace(/<\/div>$/, "")}</div>
      <p class="cl-eto-line">${esc(WIN_LINES[Math.floor(Math.random() * WIN_LINES.length)])}</p>
      <div class="cl-eacts">${nxt ? `<button class="cl-btn" data-w="next">Quête suivante ›</button>` : ""}<button class="cl-btn ghost" data-w="stay">Rester ici</button><button class="cl-btn ghost" data-w="home">Accueil</button></div></div>`;
    ST.root.appendChild(w);
    w.onclick = (e) => { const b = e.target.closest("[data-w]"); if (!b) return; w.remove(); if (b.dataset.w === "next") { goHome(); openQuest(nxt.id); } else if (b.dataset.w === "home") goHome(); };
    etoSay(`Bravo ! ${r.first ? "+" + r.gained + " XP." : ""}`);
  }
  const WIN_LINES = ["Tu viens de transformer une idée en machine qui obéit. Respire, c'est beau.", "Propre. Chaque ligne que tu écris rend la suivante plus facile.", "Voilà. Tu n'avais pas besoin de la réponse, seulement d'un peu de silence.", "Le code fonctionne, et surtout : c'est toi qui l'as trouvé."];

  // ------------------------------------------------------------------ ouverture / fermeture
  CL.open = async () => {
    mount(); ST.root.hidden = false; document.documentElement.classList.add("cl-open");
    $("#cl-home").hidden = false; $("#cl-edit").hidden = true;
    renderHome();
  };
  CL.close = () => {
    if (!ST.root || ST.root.hidden) return;
    flushEditor(); saveAll(); ST.root.hidden = true; document.documentElement.classList.remove("cl-open");
    if (E.tools && E.tools.show) E.tools.show("");
  };
  // bouton retour d'Android : ferme d'abord l'aperçu / la fiche de victoire, puis revient à l'accueil, puis quitte CodeLab
  CL.back = () => {
    if (!ST.root || ST.root.hidden) return false;
    const top = ST.root.querySelector(".cl-win,.cl-prev"); if (top) { top.remove(); return true; }
    if (ST.sheet !== "closed" && view() === "edit") { setSheet("closed"); return true; }
    if (view() === "edit") { goHome(); return true; }
    CL.close(); return true;
  };
  CL._state = ST; CL._L = L;

  E.suite.register({
    id: "codelab", group: "dev", title: "CodeLab", sub: "Code, compile, apprends avec ETO",
    icon: ICON.code,
    build(el) {
      el.innerHTML = `<div class="card cl-launch"><h3>CodeLab</h3><p class="muted">Éditeur de code tactile, terminal, et quêtes guidées par ETO. HTML, CSS et JavaScript tournent sur ton téléphone ; Python, C, C++, Java, SQL et Shell s'exécutent sur le serveur Dual Pulse (compte cloud requis).</p><button class="btn" id="cl-go">OUVRIR CODELAB</button></div>`;
      el.querySelector("#cl-go").onclick = () => CL.open();
    },
    onShow() { CL.open(); },
  });
})();
