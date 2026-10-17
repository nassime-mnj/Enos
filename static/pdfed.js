"use strict";
// ÉDITEUR PDF : pages (glisser-déposer, rotation, suppression), annotation, caviardage, édition de texte, signature, outils, sécurité, IA.
// Le serveur garde UN document de travail (versions successives = « annuler »). Les modifications de contenu sont préparées ici (liste « en attente »),
// puis envoyées en un seul lot. Coordonnées échangées : fractions (0..1) de la page telle qu'affichée.
(() => {
  const $ = (id) => document.getElementById(id);
  if (!$("pe") || !$("b-pdf")) return;
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const bytes = (n) => (n < 1024 ? n + " o" : n < 1048576 ? (n / 1024).toFixed(1) + " Ko" : (n / 1048576).toFixed(2) + " Mo");
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function api(path, opts = {}) {
    const h = { "X-Nasko-Token": TOKEN };
    let body = opts.body;
    if (body !== undefined && !(body instanceof FormData)) { h["Content-Type"] = "application/json"; body = JSON.stringify(body); }
    const r = await fetch(path, { method: opts.method || (body !== undefined ? "POST" : "GET"), headers: h, body });
    if (!r.ok) {
      let d = r.statusText;
      try { d = (await r.json()).detail || d; } catch (e) {}
      throw new Error(typeof d === "string" ? d : "requête refusée");
    }
    return r.json();
  }

  // ------------------------------------------------------------------ état
  let doc = null;               // état serveur : {has_doc, name, ver, pages:[{w,h,rot}], size, can_undo, has_text, tools}
  let tab = "pages";
  let arr = [];                 // organisation en attente : [{src, rot}] (src = -1 : page blanche)
  let arrDirty = false;
  const sel = new Set();        // indices de arr
  let cur = 0;                  // page affichée dans la visionneuse
  let tool = "highlight";
  let pending = [];             // modifications de contenu en attente
  let zoom = 1;
  let lines = [];               // lignes de texte de la page affichée (outil « éditer le texte »)
  let sig = null;               // signature : {data, w, h}
  let chat = [];                // [{q, a}]
  let busy = false;
  const opt = { color: "#ffeb3b", size: 14, width: 3, label: "APPROUVÉ", stampColor: "#cc0000", bold: false, family: "sans-serif" };
  const imgCache = new Map();
  let imgVer = -1;
  let toastT = 0;
  let lastFiles = null;         // fichiers en attente d'un mot de passe

  const isOpen = () => !$("pe").hidden;
  const hasDoc = () => !!(doc && doc.has_doc);
  const tools = () => (doc && doc.tools) || {};

  // ------------------------------------------------------------------ utilitaires d'interface
  function toast(msg, bad) {
    const t = $("pe-toast"); t.textContent = msg; t.className = "pe-toast show" + (bad ? " bad" : "");
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = "pe-toast"), bad ? 6000 : 3500);
  }

  function modal(title, bodyHtml, buttons, onMount) {
    return new Promise((resolve) => {
      $("pe-mt").textContent = title; $("pe-mb").innerHTML = bodyHtml;
      const acts = $("pe-ma"); acts.innerHTML = "";
      const done = (v) => { $("pe-modal").hidden = true; resolve(v); };
      buttons.forEach((b) => {
        const el = document.createElement("button");
        el.className = "btn" + (b.cls ? " " + b.cls : ""); el.textContent = b.label;
        el.onclick = () => done(typeof b.value === "function" ? b.value() : b.value);
        acts.appendChild(el);
      });
      $("pe-modal").hidden = false;
      if (onMount) onMount(done);
    });
  }
  const ask = (title, body, yes = "CONFIRMER", cls = "") => modal(title, `<p class="pe-p">${body}</p>`, [{ label: "ANNULER", value: false }, { label: yes, value: true, cls }]);

  function showFiles(title, files, note) {
    const html = (note ? `<p class="pe-p">${esc(note)}</p>` : "") + `<div class="pe-files">` +
      files.map((f) => `<a href="${esc(f.link)}" download="${esc(f.name)}"><span>${esc(f.name)}</span><em>${bytes(f.size)}</em></a>`).join("") + `</div>` +
      `<p class="pe-p">Les fichiers sont aussi dans le dossier « Editeur PDF / Livraison ».</p>`;
    return modal(title, html, [{ label: "OUVRIR LE DOSSIER", value: "folder" }, { label: "FERMER", value: false, cls: "on" }]).then((v) => {
      if (v === "folder") api("/api/pdf/open-folder", { method: "POST", body: {} }).catch((e) => toast(e.message, true));
    });
  }

  // ------------------------------------------------------------------ images (jeton dans l'en-tête : fetch -> blob)
  async function pageImg(n, z, fmt) {
    if (imgVer !== doc.ver) { imgCache.forEach((u) => URL.revokeObjectURL(u)); imgCache.clear(); imgVer = doc.ver; }
    const key = `${n}:${z}:${fmt}`;
    if (imgCache.has(key)) return imgCache.get(key);
    const r = await fetch(`/api/pdf/page?n=${n}&z=${z}&fmt=${fmt}&v=${doc.ver}`, { headers: { "X-Nasko-Token": TOKEN } });
    if (!r.ok) throw new Error("page illisible");
    const url = URL.createObjectURL(await r.blob());
    imgCache.set(key, url);
    return url;
  }

  // ------------------------------------------------------------------ ouverture / fermeture
  async function open() {
    $("pe").hidden = false; document.body.classList.remove("menu-open");
    try { await refresh(); } catch (e) { toast(e.message, true); }
  }
  async function close() {
    if (!(await guard())) return;
    $("pe").hidden = true;
  }

  async function refresh(st) {
    doc = st || (await api("/api/pdf/state"));
    syncDoc();
  }

  function syncDoc() {
    $("pe-empty").hidden = hasDoc();
    $("pe-body").hidden = !hasDoc();
    ["pe-add", "pe-undo", "pe-save", "pe-new"].forEach((id) => ($(id).hidden = !hasDoc() && id !== "pe-add"));
    $("pe-add").hidden = false;
    $("pe-undo").disabled = !(doc && doc.can_undo);
    if (!hasDoc()) { $("pe-sub").textContent = "Pages · annotation · caviardage · signature · OCR · IA — 100 % local"; return; }
    $("pe-sub").textContent = `${doc.name} · ${doc.pages.length} page${doc.pages.length > 1 ? "s" : ""} · ${bytes(doc.size)}`;
    arr = doc.pages.map((_, i) => ({ src: i, rot: 0 })); arrDirty = false; sel.clear();
    cur = clamp(cur, 0, doc.pages.length - 1);
    render();
  }

  // ------------------------------------------------------------------ onglets
  const VIEWER_TABS = ["annot", "edit", "sign"];
  async function setTab(t) {
    if (t === tab && !busy) { render(); return; }
    if (!(await flushArr())) return;
    if (!VIEWER_TABS.includes(t) && pending.length && !(await guard())) return;
    tab = t;
    if (t === "annot" && !["highlight", "underline", "strike", "text", "note", "stamp", "pen", "rect"].includes(tool)) tool = "highlight";
    if (t === "edit" && !["edittext", "redact"].includes(tool)) tool = "edittext";
    if (t === "sign") tool = "sigplace";
    render();
  }

  function render() {
    if (!hasDoc()) return;
    document.querySelectorAll("#pe-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
    const viewer = VIEWER_TABS.includes(tab);
    $("pe-v-pages").hidden = tab !== "pages";
    $("pe-v-page").hidden = !viewer;
    $("pe-v-doc").hidden = true;
    if (tab === "pages") renderGrid();
    if (viewer) renderViewer();
    renderPanel();
    status();
  }

  function status() {
    if (!hasDoc()) return;
    const n = arr.length;
    $("pe-st1").textContent = tab === "pages" ? `${n} page${n > 1 ? "s" : ""}${sel.size ? ` · ${sel.size} sélectionnée${sel.size > 1 ? "s" : ""}` : ""}${arrDirty ? " · organisation non appliquée" : ""}` : `Page ${cur + 1} / ${doc.pages.length}`;
    $("pe-st2").textContent = pending.length ? `${pending.length} modification${pending.length > 1 ? "s" : ""} en attente` : "";
  }

  // ------------------------------------------------------------------ PAGES : grille, glisser-déposer
  let io = null;
  function renderGrid() {
    const g = $("pe-v-pages");
    g.innerHTML = "";
    if (io) io.disconnect();
    io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); loadThumb(e.target); } }), { root: g, rootMargin: "300px" });
    arr.forEach((p, i) => {
      const c = document.createElement("div");
      c.className = "pe-card" + (sel.has(i) ? " sel" : "") + (p.src < 0 ? " blank" : "");
      c.draggable = true; c.dataset.i = i;
      const orig = p.src >= 0 ? doc.pages[p.src] : null;
      c.innerHTML = `<div class="pe-th">${p.src >= 0 ? '<span class="sk">…</span>' : '<span class="sk" style="color:#999">PAGE BLANCHE</span>'}</div>
        <div class="nm"><b>${i + 1}</b>${p.src >= 0 && p.src !== i ? `<span>(était ${p.src + 1})</span>` : ""}${p.rot ? `<em>↻ ${p.rot}°</em>` : ""}</div>
        <div class="pe-act"><button data-a="l" title="Pivoter à gauche (90°)">↺</button><button data-a="r" title="Pivoter à droite (90°)">↻</button><button data-a="f" title="Pivoter de 180°">⇅</button><button data-a="dup" title="Dupliquer">⧉</button><button class="d" data-a="del" title="Supprimer">✕</button></div>`;
      c.dataset.src = p.src;
      if (orig) { c.dataset.w = orig.w; c.dataset.h = orig.h; io.observe(c); }
      g.appendChild(c);
      if (p.src >= 0) applyRotCss(c, p.rot);
    });
  }

  function applyRotCss(c, rot) {
    const im = c.querySelector("img"); if (!im) return;
    im.style.setProperty("--r", rot + "deg"); im.classList.toggle("odd", rot % 180 !== 0);
  }

  async function loadThumb(c) {
    const src = +c.dataset.src;
    try {
      const url = await pageImg(src, 0.3, "jpg");
      const th = c.querySelector(".pe-th"); th.innerHTML = ""; const im = document.createElement("img"); im.src = url; im.draggable = false; th.appendChild(im);
      applyRotCss(c, arr[+c.dataset.i] ? arr[+c.dataset.i].rot : 0);
    } catch (e) { const s = c.querySelector(".sk"); if (s) s.textContent = "indisponible"; }
  }

  function markDirty() { arrDirty = true; renderGrid(); renderPanel(); status(); }

  function rotateSel(deg, idxs) {
    (idxs || [...sel]).forEach((i) => { if (arr[i]) arr[i].rot = ((arr[i].rot + deg) % 360 + 360) % 360; });
    markDirty();
  }
  function deleteIdx(idxs) {
    const s = new Set(idxs);
    if (s.size >= arr.length) return toast("Un document doit garder au moins une page.", true);
    arr = arr.filter((_, i) => !s.has(i)); sel.clear(); markDirty();
  }
  function dupIdx(idxs) {
    const out = []; arr.forEach((p, i) => { out.push(p); if (idxs.includes(i)) out.push({ ...p }); });
    arr = out; sel.clear(); markDirty();
  }
  function blankAfter() {
    const at = sel.size ? Math.max(...sel) + 1 : arr.length;
    arr.splice(at, 0, { src: -1, rot: 0 }); sel.clear(); markDirty();
  }

  async function flushArr() {
    if (!arrDirty) return true;
    try {
      busy = true;
      const st = await api("/api/pdf/arrange", { body: { pages: arr } });
      arrDirty = false; busy = false;
      await refresh(st);
      toast("Organisation des pages appliquée.");
      return true;
    } catch (e) { busy = false; toast(e.message, true); return false; }
  }

  let dragIdx = [];
  function gridEvents() {
    const g = $("pe-v-pages");
    g.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-a]"), c = e.target.closest(".pe-card");
      if (!c) { if (!e.target.closest(".pe-card")) { sel.clear(); renderGrid(); renderPanel(); status(); } return; }
      const i = +c.dataset.i;
      if (btn) {
        const a = btn.dataset.a, tgt = sel.has(i) && sel.size > 1 ? [...sel] : [i];
        if (a === "l") rotateSel(-90, tgt); else if (a === "r") rotateSel(90, tgt); else if (a === "f") rotateSel(180, tgt);
        else if (a === "dup") dupIdx(tgt); else if (a === "del") deleteIdx(tgt);
        return;
      }
      if (e.ctrlKey || e.metaKey) { sel.has(i) ? sel.delete(i) : sel.add(i); }
      else if (e.shiftKey && sel.size) { const a = Math.min(...sel, i), b = Math.max(...sel, i); for (let k = a; k <= b; k++) sel.add(k); }
      else { sel.has(i) && sel.size === 1 ? sel.clear() : (sel.clear(), sel.add(i)); }
      renderGrid(); renderPanel(); status();
    });
    g.addEventListener("dblclick", (e) => {
      const c = e.target.closest(".pe-card"); if (!c || c.dataset.src < 0) return;
      flushArr().then((ok) => { if (ok) { cur = Math.min(+c.dataset.i, doc.pages.length - 1); tab = "annot"; tool = "highlight"; render(); } });
    });
    g.addEventListener("dragstart", (e) => {
      const c = e.target.closest(".pe-card"); if (!c) return;
      const i = +c.dataset.i;
      dragIdx = sel.has(i) ? [...sel].sort((a, b) => a - b) : [i];
      e.dataTransfer.setData("text/x-pe-page", String(i)); e.dataTransfer.effectAllowed = "move";
      requestAnimationFrame(() => dragIdx.forEach((k) => g.children[k] && g.children[k].classList.add("drag")));
    });
    g.addEventListener("dragend", () => { dragIdx = []; g.querySelectorAll(".drag,.over-l,.over-r").forEach((c) => c.classList.remove("drag", "over-l", "over-r")); });
    g.addEventListener("dragover", (e) => {
      if (!dragIdx.length) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      g.querySelectorAll(".over-l,.over-r").forEach((c) => c.classList.remove("over-l", "over-r"));
      const c = e.target.closest(".pe-card"); if (!c) return;
      const r = c.getBoundingClientRect();
      c.classList.add(e.clientX < r.left + r.width / 2 ? "over-l" : "over-r");
    });
    g.addEventListener("drop", (e) => {
      if (!dragIdx.length) return;
      e.preventDefault();
      const c = e.target.closest(".pe-card");
      let at = arr.length;
      if (c) { const r = c.getBoundingClientRect(); at = +c.dataset.i + (e.clientX < r.left + r.width / 2 ? 0 : 1); }
      const moving = dragIdx.map((i) => arr[i]);
      const before = dragIdx.filter((i) => i < at).length;
      const rest = arr.filter((_, i) => !dragIdx.includes(i));
      rest.splice(at - before, 0, ...moving);
      const newSel = moving.map((m) => rest.indexOf(m));
      arr = rest; sel.clear(); newSel.forEach((i) => sel.add(i)); dragIdx = [];
      markDirty();
    });
  }

  // ------------------------------------------------------------------ visionneuse
  let pgW = 0, pgH = 0, pgRot = 0;

  async function renderViewer() {
    const p = doc.pages[cur];
    $("pe-ptot").textContent = doc.pages.length; $("pe-pnum").value = cur + 1;
    $("pe-prev").disabled = cur <= 0; $("pe-next").disabled = cur >= doc.pages.length - 1;
    const stage = $("pe-stage"), pg = $("pe-pg");
    const fit = Math.max(260, Math.min(stage.clientWidth - 36, 1000));
    pgW = Math.round(fit * zoom); pgH = Math.round(pgW * p.h / p.w); pgRot = p.rot;
    pg.style.width = pgW + "px"; pg.style.height = pgH + "px";
    const z = clamp((pgW / p.w) * (window.devicePixelRatio || 1), 0.4, 3.5);
    const myCur = cur, myVer = doc.ver;
    try {
      const url = await pageImg(cur, +z.toFixed(2), "png");
      if (myCur === cur && myVer === doc.ver) $("pe-img").src = url;
    } catch (e) { toast(e.message, true); }
    lines = [];
    drawOps();
    if (tab === "edit" && tool === "edittext") loadLines();
    $("pe-ov").classList.toggle("nav", false);
    $("pe-vinfo").textContent = toolHint();
    status();
  }

  function toolHint() {
    return ({ highlight: "Glissez sur le texte à surligner", underline: "Glissez pour souligner", strike: "Glissez pour barrer", text: "Glissez pour tracer une zone de texte, puis tapez",
      note: "Cliquez pour poser une note", stamp: "Cliquez ou glissez pour poser le tampon", pen: "Dessinez à main levée", rect: "Glissez pour tracer un cadre",
      edittext: "Cliquez une ligne de texte pour la modifier", redact: "Glissez sur ce qui doit être noirci (définitif à l'application)", sigplace: sig ? "Cliquez ou glissez pour placer la signature" : "Créez d'abord votre signature (panneau de droite)" }[tool]) || "";
  }

  async function loadLines() {
    const n = cur;
    try { const r = await api("/api/pdf/lines?n=" + n); if (n === cur) { lines = r.lines; drawOps(); } } catch (e) { toast(e.message, true); }
  }

  function opBox(op, cls, content, rect) {
    const el = document.createElement("div");
    el.className = "pe-el " + cls;
    const [x0, y0, x1, y1] = rect || op.rect;
    el.style.cssText = `left:${x0 * 100}%;top:${y0 * 100}%;width:${(x1 - x0) * 100}%;height:${(y1 - y0) * 100}%`;
    if (content !== undefined) el.innerHTML = content;
    const x = document.createElement("button"); x.className = "x"; x.type = "button"; x.textContent = "✕"; x.title = "Retirer cette modification";
    x.onpointerdown = (e) => e.stopPropagation();
    x.onclick = (e) => { e.stopPropagation(); pending = pending.filter((o) => o !== op); drawOps(); renderPanel(); status(); };
    el.appendChild(x);
    return el;
  }

  // sens de lecture du texte tel qu'affiché (angle du texte dans le repère non pivoté, moins la rotation de la page)
  function dispAngle(angle) { return (((angle || 0) - pgRot) % 360 + 360) % 360; }
  function dirCss(a) { return a === 270 ? "writing-mode:vertical-rl;" : a === 90 ? "writing-mode:vertical-rl;transform:rotate(180deg);" : a === 180 ? "transform:rotate(180deg);" : ""; }

  function drawOps() {
    const ov = $("pe-ov");
    ov.querySelectorAll(".pe-el,.pe-ln,.pe-ghost,.pe-edit,.pe-ta").forEach((n) => n.remove());
    const svg = $("pe-svg"); svg.innerHTML = "";
    const pxPerPt = pgW / doc.pages[cur].w;
    pending.forEach((op) => {
      if (op.page !== cur) return;
      let el = null;
      switch (op.type) {
        case "highlight": el = opBox(op, "hl"); el.style.background = op.color; break;
        case "underline": el = opBox(op, "ul"); el.style.borderBottomColor = op.color; break;
        case "strike": el = opBox(op, "st"); el.style.setProperty("--c", op.color); break;
        case "rect": el = opBox(op, "rc"); el.style.borderColor = op.color; break;
        case "redact": el = opBox(op, "rd"); break;
        case "text": el = opBox(op, "tx"); el.insertAdjacentText("afterbegin", op.text); el.style.fontSize = op.size * pxPerPt + "px"; el.style.color = op.color; el.style.fontFamily = op.family === "serif" ? "serif" : op.family === "monospace" ? "monospace" : "Arial,sans-serif"; if (op.bold) el.style.fontWeight = "700"; break;
        case "note": el = opBox(op, "nt", "✎", [op.x, op.y, op.x + 22 / pgW, op.y + 22 / pgH]); el.title = op.text; break;
        case "stamp": el = opBox(op, "sp"); el.insertAdjacentText("afterbegin", op.label); el.style.color = op.color; el.style.borderColor = op.color; el.style.fontSize = Math.max(8, (op.rect[3] - op.rect[1]) * pgH * 0.4) + "px"; break;
        case "image": el = opBox(op, "im", `<img src="${op.data}" alt="">`); break;
        case "edittext": {
          el = opBox(op, "ed", "");
          const a = dispAngle(op.angle);
          const inner = document.createElement("span"); inner.textContent = op.text;
          inner.style.cssText = `font-size:${op.size * pxPerPt}px;color:${op.color};font-family:${op.family === "serif" ? "serif" : op.family === "monospace" ? "monospace" : "Arial,sans-serif"};${op.bold ? "font-weight:700;" : ""}${op.italic ? "font-style:italic;" : ""}${dirCss(a)}`;
          el.insertBefore(inner, el.firstChild);
          if (op.text.length > op.oldLen) { const w = (op.rect[2] - op.rect[0]) * (op.text.length / Math.max(1, op.oldLen)); if (a === 0) el.style.width = Math.min(w, 1 - op.rect[0] - 0.02) * 100 + "%"; }
          break;
        }
        case "ink": {
          const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
          pl.setAttribute("points", op.points.map(([x, y]) => `${x * pgW},${y * pgH}`).join(" ")); pl.setAttribute("fill", "none"); pl.setAttribute("stroke", op.color);
          pl.setAttribute("stroke-width", op.width); pl.setAttribute("stroke-linecap", "round"); pl.setAttribute("stroke-linejoin", "round");
          svg.appendChild(pl); break;
        }
        default: break;
      }
      if (el) ov.appendChild(el);
    });
    if (tab === "edit" && tool === "edittext") {
      lines.forEach((l, i) => {
        if (pending.some((o) => o.page === cur && o.lineIdx === i && o.type === "edittext")) return;
        const d = document.createElement("div"); d.className = "pe-ln";
        d.style.cssText = `left:${l.x0 * 100}%;top:${l.y0 * 100}%;width:${(l.x1 - l.x0) * 100}%;height:${(l.y1 - l.y0) * 100}%`;
        d.title = l.text; d.onpointerdown = (e) => e.stopPropagation(); d.onclick = (e) => { e.stopPropagation(); startEditLine(i); };
        ov.appendChild(d);
      });
    }
    ov.style.cursor = tool === "edittext" ? "default" : "crosshair";
  }

  // ---- édition d'une ligne de texte
  function startEditLine(i) {
    const l = lines[i], ov = $("pe-ov"), pxPerPt = pgW / doc.pages[cur].w;
    ov.querySelectorAll(".pe-edit").forEach((n) => n.remove());
    const a = dispAngle(l.angle);
    const inp = document.createElement("input"); inp.type = "text"; inp.className = "pe-edit"; inp.value = l.text; inp.spellcheck = false;
    const w = (l.x1 - l.x0) * pgW, h = (l.y1 - l.y0) * pgH;
    inp.style.cssText = `left:${l.x0 * 100}%;top:${l.y0 * 100}%;font-size:${l.size * pxPerPt}px;font-family:${l.family === "serif" ? "serif" : l.family === "monospace" ? "monospace" : "Arial,sans-serif"};` +
      (a === 0 || a === 180 ? `width:${Math.max(w + 40, 120)}px;height:${Math.max(h, 14)}px;` : `height:${Math.max(h + 40, 120)}px;width:${Math.max(w, 14)}px;`) + dirCss(a);
    ov.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const commit = (save) => {
      if (done) return; done = true;
      const v = inp.value; inp.remove();
      if (save && v !== l.text && v.trim() !== "") {
        pending.push({ type: "edittext", page: cur, rect: [l.x0, l.y0, l.x1, l.y1], text: v, oldLen: l.text.length, old_len: l.text.length, size: l.size, color: l.color, family: l.family, bold: l.bold, italic: l.italic, angle: l.angle, lineIdx: i });
      } else if (save && v.trim() === "" ) toast("Pour supprimer du contenu, utilisez le caviardage.", true);
      drawOps(); renderPanel(); status();
    };
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); commit(true); } else if (e.key === "Escape") { e.stopPropagation(); commit(false); } };
    inp.onblur = () => commit(true);
  }

  // ---- gestes sur la page
  function frac(e) {
    const r = $("pe-ov").getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
  }
  const RECT_TOOLS = ["highlight", "underline", "strike", "rect", "redact", "text", "stamp", "sigplace"];

  function overlayEvents() {
    const ov = $("pe-ov");
    let st = null, ghost = null;
    ov.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".pe-edit,.pe-ta")) return;
      ov.querySelectorAll(".pe-edit,.pe-ta").forEach((n) => n.blur && n.blur());
      if (tool === "edittext") return;
      const p = frac(e);
      if (tool === "note") { st = { note: p }; ov.setPointerCapture(e.pointerId); return; }        // le champ est créé au relâchement : sinon le focus lui est retiré par le mousedown en cours
      if (tool === "sigplace" && !sig) { toast("Créez d'abord votre signature dans le panneau de droite.", true); return; }
      ov.setPointerCapture(e.pointerId);
      if (tool === "pen") { st = { pts: [p] }; return; }
      if (RECT_TOOLS.includes(tool)) { st = { a: p, b: p }; ghost = document.createElement("div"); ghost.className = "pe-ghost"; ov.appendChild(ghost); }
    });
    ov.addEventListener("pointermove", (e) => {
      if (!st || st.note) return;
      const p = frac(e);
      if (st.pts) {
        st.pts.push(p);
        let pl = $("pe-svg").querySelector("polyline.live");
        if (!pl) { pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline"); pl.setAttribute("class", "live"); pl.setAttribute("fill", "none"); pl.setAttribute("stroke", opt.color === "#ffeb3b" ? "#e53935" : opt.color); pl.setAttribute("stroke-width", opt.width); pl.setAttribute("stroke-linecap", "round"); $("pe-svg").appendChild(pl); }
        pl.setAttribute("points", st.pts.map(([x, y]) => `${x * pgW},${y * pgH}`).join(" "));
        return;
      }
      st.b = p;
      const x0 = Math.min(st.a[0], p[0]), y0 = Math.min(st.a[1], p[1]);
      ghost.style.cssText = `left:${x0 * 100}%;top:${y0 * 100}%;width:${Math.abs(p[0] - st.a[0]) * 100}%;height:${Math.abs(p[1] - st.a[1]) * 100}%`;
    });
    const finish = () => {
      if (!st) return;
      const s = st; st = null; if (ghost) { ghost.remove(); ghost = null; }
      if (s.note) { const p = s.note; askText(p, null, (t) => { if (t) addOp({ type: "note", page: cur, x: p[0], y: p[1], text: t, color: "#ffd23f" }); }, "Texte de la note"); return; }
      if (s.pts) {
        if (s.pts.length > 2) addOp({ type: "ink", page: cur, points: s.pts.filter((_, i) => i % 2 === 0 || i === s.pts.length - 1), color: opt.color === "#ffeb3b" ? "#e53935" : opt.color, width: opt.width });
        else drawOps();
        return;
      }
      let [x0, y0] = s.a, [x1, y1] = s.b;
      const dragged = Math.abs(x1 - x0) * pgW > 6 && Math.abs(y1 - y0) * pgH > 6;
      if (!dragged) {                                                // simple clic : taille par défaut
        const dw = { text: 0.3, stamp: 0.26, sigplace: 0.25 }[tool], dh = tool === "text" ? 0.06 : tool === "stamp" ? 0.07 : 0;
        if (!dw) return;
        const w = dw, h = tool === "sigplace" ? (w * pgW * (sig.h / sig.w)) / pgH : dh;
        x0 = clamp(s.a[0] - w / 2, 0, 1 - w); y0 = clamp(s.a[1] - h / 2, 0, 1 - h); x1 = x0 + w; y1 = y0 + h;
      } else { [x0, x1] = [Math.min(x0, x1), Math.max(x0, x1)]; [y0, y1] = [Math.min(y0, y1), Math.max(y0, y1)]; }
      const rect = [x0, y0, x1, y1];
      if (tool === "text") askText([x0, y0], rect, (t) => { if (t) addOp({ type: "text", page: cur, rect, text: t, size: opt.size, color: opt.color === "#ffeb3b" ? "#000000" : opt.color, family: opt.family, bold: opt.bold }); }, "");
      else if (tool === "stamp") addOp({ type: "stamp", page: cur, rect, label: opt.label, color: opt.stampColor });
      else if (tool === "sigplace") addOp({ type: "image", page: cur, rect, data: sig.data, keep: true });
      else if (tool === "redact") addOp({ type: "redact", page: cur, rect });
      else addOp({ type: tool, page: cur, rect, color: tool === "highlight" ? opt.color : (opt.color === "#ffeb3b" ? "#e53935" : opt.color) });
    };
    ov.addEventListener("pointerup", finish);
    ov.addEventListener("pointercancel", () => { st = null; if (ghost) { ghost.remove(); ghost = null; } drawOps(); });
  }

  function addOp(op) { pending.push(op); drawOps(); renderPanel(); status(); }

  // petite zone de saisie sur la page (texte libre, note)
  function askText(p, rect, cb, placeholder) {
    const ov = $("pe-ov"), pxPerPt = pgW / doc.pages[cur].w;
    const ta = document.createElement("textarea"); ta.className = "pe-ta"; ta.placeholder = placeholder || "Tapez votre texte…";
    const w = rect ? (rect[2] - rect[0]) * 100 : 28, h = rect ? (rect[3] - rect[1]) * 100 : 12;
    ta.style.cssText = `left:${(rect ? rect[0] : p[0]) * 100}%;top:${(rect ? rect[1] : p[1]) * 100}%;width:${Math.max(w, 14)}%;min-height:${Math.max(h, 6)}%;font-size:${(rect ? opt.size * pxPerPt : 13)}px;`;
    ov.appendChild(ta); ta.focus();
    let done = false;
    const end = (save) => { if (done) return; done = true; const v = ta.value.replace(/\s+$/, ""); ta.remove(); cb(save ? v : ""); };
    ta.onkeydown = (e) => { if (e.key === "Escape") { e.stopPropagation(); end(false); } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); end(true); } };
    ta.onblur = () => end(true);
  }

  // ------------------------------------------------------------------ envoi du lot de modifications
  async function applyPending() {
    if (!pending.length) return true;
    const ops = pending.map((o) => { const c = {}; Object.keys(o).forEach((k) => { if (k !== "lineIdx" && k !== "oldLen") c[k] = o[k]; }); return c; });
    try {
      busy = true;
      const st = await api("/api/pdf/annotate", { body: { ops } });
      busy = false; pending = [];
      await refresh(st);
      toast(ops.some((o) => o.type === "redact" || o.type === "redact_text") ? "Modifications appliquées — le contenu caviardé est définitivement supprimé." : "Modifications appliquées.");
      return true;
    } catch (e) { busy = false; toast(e.message, true); return false; }
  }

  // modifications non appliquées : proposer d'appliquer / abandonner avant de quitter
  async function guard() {
    if (!pending.length) return flushArr();
    const r = await modal("MODIFICATIONS NON APPLIQUÉES", `<p class="pe-p">${pending.length} modification${pending.length > 1 ? "s" : ""} en attente. Les appliquer au document ?</p>`,
      [{ label: "RESTER", value: "stay" }, { label: "ABANDONNER", value: "drop", cls: "danger" }, { label: "APPLIQUER", value: "apply", cls: "on" }]);
    if (r === "stay") return false;
    if (r === "drop") { pending = []; drawOps(); return flushArr(); }
    return (await applyPending()) && flushArr();
  }

  // ------------------------------------------------------------------ panneaux
  const sec = (title, body, open) => `<details class="pe-box"${open ? " open" : ""}><summary>${title}</summary>${body}</details>`;
  const note = (t) => `<p class="pe-p">${t}</p>`;

  function pendingBox() {
    if (!pending.length) return `<div class="pe-box">${note("Aucune modification en attente. Vos changements sont préparés ici puis appliqués en une fois.")}</div>`;
    const label = (o) => ({ highlight: "Surlignage", underline: "Soulignement", strike: "Texte barré", rect: "Cadre", redact: "Caviardage", text: "Texte : " + (o.text || "").slice(0, 24), note: "Note",
      stamp: "Tampon " + (o.label || ""), image: "Signature / image", edittext: "Texte modifié : " + (o.text || "").slice(0, 22), ink: "Dessin",
      redact_text: "Caviarder « " + (o.query || o.preset || "") + " »" }[o.type] || o.type) + (o.page !== undefined ? ` · p.${o.page + 1}` : "");
    return `<div class="pe-box"><h4>EN ATTENTE (${pending.length})</h4><div class="pe-pend">${pending.map((o, i) => `<div><span>${esc(label(o))}</span><button data-rm="${i}" title="Retirer">✕</button></div>`).join("")}</div>
      <div class="pe-row"><button class="btn on" id="pe-apply">APPLIQUER</button><button class="btn danger" id="pe-drop">TOUT ABANDONNER</button></div></div>`;
  }

  function colorRow(id, val, label) { return `<label>${label}<input type="color" id="${id}" value="${val}"></label>`; }

  function panelPages() {
    const n = sel.size, none = n === 0;
    return `<div class="pe-box"><h4>ORGANISER</h4>${note("Glissez les pages pour les réordonner. Clic = sélection (Ctrl / Maj pour plusieurs). Double-clic = ouvrir la page.")}
      <div class="pe-bulk"><button class="btn" id="pg-l" ${none ? "disabled" : ""}>↺ 90°</button><button class="btn" id="pg-r" ${none ? "disabled" : ""}>↻ 90°</button><button class="btn" id="pg-f" ${none ? "disabled" : ""}>⇅ 180°</button>
      <button class="btn" id="pg-dup" ${none ? "disabled" : ""}>⧉ DUPLIQUER</button><button class="btn danger" id="pg-del" ${none ? "disabled" : ""}>✕ SUPPRIMER</button><button class="btn" id="pg-blank">+ PAGE BLANCHE</button></div>
      <div class="pe-row"><button class="btn" id="pg-all">TOUT SÉLECTIONNER</button><button class="btn" id="pg-odd">IMPAIRES</button><button class="btn" id="pg-even">PAIRES</button></div>
      <div class="pe-row"><button class="btn big${arrDirty ? " on" : ""}" id="pg-apply" ${arrDirty ? "" : "disabled"}>APPLIQUER L'ORGANISATION</button></div>
      ${arrDirty ? `<div class="pe-row"><button class="btn" id="pg-reset">ANNULER CES CHANGEMENTS</button></div>` : ""}</div>
      ${sec("EXTRAIRE DES PAGES", `${note("Crée un nouveau PDF avec les pages choisies (le document ouvert n'est pas modifié).")}
        <div class="pe-row"><input type="text" id="ex-spec" placeholder="ex. 3-5, 8, 10-" value="${esc(selSpec())}"><button class="btn" id="ex-go">EXTRAIRE</button></div>`, true)}
      ${sec("DIVISER EN PLUSIEURS FICHIERS", `<div class="pe-row col"><select id="sp-mode"><option value="each">Une page par fichier</option><option value="every">Tous les N pages</option><option value="ranges">Par plages (1-3; 4-6; 7-)</option><option value="bookmarks">Par signets (chapitres)</option></select>
        <input type="text" id="sp-val" placeholder="" hidden><button class="btn" id="sp-go">DIVISER</button></div>`)}`;
  }

  function selSpec() {
    if (!sel.size || arrDirty) return "";
    const a = [...sel].filter((i) => arr[i].src >= 0).map((i) => arr[i].src + 1).sort((x, y) => x - y);
    const out = []; let s = a[0], p = a[0];
    for (let k = 1; k <= a.length; k++) { if (a[k] !== p + 1) { out.push(s === p ? "" + s : `${s}-${p}`); s = a[k]; } p = a[k]; }
    return out.join(", ");
  }

  const TOOLS_ANNOT = [["highlight", "▮", "Surligner"], ["underline", "U̲", "Souligner"], ["strike", "S̶", "Barrer"], ["text", "T", "Texte libre"], ["note", "✎", "Note adhésive"], ["stamp", "⬚", "Tampon"], ["pen", "∿", "Dessin"], ["rect", "▭", "Cadre"]];

  function panelAnnot() {
    const stamps = ["APPROUVÉ", "REFUSÉ", "CONFIDENTIEL", "BROUILLON", "URGENT", "VÉRIFIÉ", "COPIE"];
    return `<div class="pe-box"><h4>OUTIL</h4><div class="pe-tools">${TOOLS_ANNOT.map(([k, i, l]) => `<button class="btn${tool === k ? " on" : ""}" data-tool="${k}"><i>${i}</i>${l}</button>`).join("")}</div></div>
      <div class="pe-box"><h4>RÉGLAGES</h4><div class="pe-row">${colorRow("o-color", opt.color, "COULEUR")}
        ${["text"].includes(tool) ? `<label>TAILLE <input type="number" id="o-size" min="6" max="120" value="${opt.size}" style="width:64px"></label><label><input type="checkbox" id="o-bold" ${opt.bold ? "checked" : ""}> GRAS</label>
          <select id="o-fam"><option value="sans-serif">Sans-serif</option><option value="serif"${opt.family === "serif" ? " selected" : ""}>Serif</option><option value="monospace"${opt.family === "monospace" ? " selected" : ""}>Monospace</option></select>` : ""}
        ${tool === "pen" ? `<label>ÉPAISSEUR <input type="range" id="o-width" min="1" max="12" value="${opt.width}"></label>` : ""}</div>
        ${tool === "stamp" ? `<div class="pe-chips" id="o-stamps">${stamps.map((s) => `<button class="${opt.label === s ? "on" : ""}">${s}</button>`).join("")}</div>
          <div class="pe-row"><input type="text" id="o-label" value="${esc(opt.label)}" maxlength="40" placeholder="Texte du tampon">${colorRow("o-scolor", opt.stampColor, "")}</div>` : ""}
        ${note("Le surlignage et le texte sont aussi lisibles dans n'importe quel lecteur PDF.")}</div>
      ${pendingBox()}`;
  }

  function panelEdit() {
    const presets = [["iban", "IBAN"], ["email", "E-mail"], ["phone", "Téléphone"], ["card", "N° de carte"], ["ssn", "N° sécu"]];
    return `<div class="pe-box"><h4>OUTIL</h4><div class="pe-tools"><button class="btn${tool === "edittext" ? " on" : ""}" data-tool="edittext"><i>Aa</i>Modifier le texte</button><button class="btn${tool === "redact" ? " on" : ""}" data-tool="redact"><i>■</i>Caviarder</button></div>
      ${tool === "edittext" ? note("Cliquez une ligne de la page, tapez le nouveau texte, <b>Entrée</b> pour valider. Police et taille sont reprises de l'original quand c'est possible. Idéal pour une faute de frappe ou une date ; pour réécrire un paragraphe, modifiez ligne par ligne.") :
        note("Tracez un bloc sur ce qui doit disparaître. À l'application, le texte, les pixels des images et les métadonnées sous le bloc sont <b>supprimés définitivement</b> : ils ne sont pas seulement masqués.")}</div>
      ${sec("CAVIARDER PAR RECHERCHE", `${note("Noircit toutes les occurrences d'un texte, ou d'un type de donnée sensible, sur tout le document.")}
        <div class="pe-row"><input type="text" id="rs-q" placeholder="texte exact (nom, adresse…)"></div>
        <div class="pe-chips" id="rs-presets">${presets.map(([k, l]) => `<button data-p="${k}">${l}</button>`).join("")}</div>
        <div class="pe-row"><input type="text" id="rs-pages" placeholder="pages (vide = toutes)"><button class="btn" id="rs-add">AJOUTER</button></div>`, tool === "redact")}
      ${pendingBox()}`;
  }

  function panelSign() {
    return `<div class="pe-box"><h4>VOTRE SIGNATURE</h4>
      <div class="pe-chips" id="sg-tabs"><button data-m="draw" class="on">DESSINER</button><button data-m="type">TAPER</button><button data-m="img">IMPORTER</button></div>
      <div id="sg-pane" style="margin-top:10px"></div>
      <div class="pe-row"><button class="btn on" id="sg-use">UTILISER</button><button class="btn" id="sg-clear">EFFACER</button></div>
      ${sig ? `<h4 style="margin-top:8px">SIGNATURE ACTIVE</h4><div class="pe-sigprev"><img src="${sig.data}" alt="signature"></div>${note("Cliquez sur la page (ou glissez un cadre) pour la placer. Elle reste sur cette session.")}` : note("Dessinez, tapez ou importez votre signature, puis cliquez UTILISER.")}</div>
      ${pendingBox()}`;
  }

  function panelTools() {
    const t = tools();
    const cmp = doc ? bytes(doc.size) : "";
    return `${sec("COMPRESSER", `${note(`Poids actuel : <b>${cmp}</b>. Réduit le poids pour l'envoi par e-mail.`)}
      <div class="pe-row col"><select id="cp-lvl"><option value="light">Léger — sans perte (nettoyage, polices)</option><option value="medium" selected>Équilibré — images à 150 dpi</option><option value="strong">Maximum — images à 100 dpi</option></select><button class="btn on" id="cp-go">COMPRESSER</button></div><div id="cp-res"></div>`, true)}
      ${sec("OCR · RENDRE LE TEXTE SÉLECTIONNABLE", `${t.ocr ? "" : `<div class="pe-warn">Tesseract OCR n'est pas installé : installez-le (avec les langues) puis relancez E.N.O.S.</div>`}
        ${doc && doc.has_text ? note("Ce document contient déjà du texte ; seules les pages sans texte seront traitées.") : note("Document scanné détecté : l'OCR ajoutera une couche de texte invisible (copier, rechercher, indexer).")}
        <div class="pe-row"><label>LANGUE <select id="oc-lang"><option value="fra+eng">Français + anglais</option><option value="fra">Français</option><option value="eng">Anglais</option><option value="spa+eng">Espagnol + anglais</option><option value="deu+eng">Allemand + anglais</option><option value="ita+eng">Italien + anglais</option></select></label></div>
        <div class="pe-row"><label><input type="checkbox" id="oc-force"> traiter aussi les pages qui ont déjà du texte</label></div><button class="btn on" id="oc-go" ${t.ocr ? "" : "disabled"}>LANCER L'OCR</button>`)}
      ${sec("FILIGRANE", `<div class="pe-row"><input type="text" id="wm-text" placeholder="Texte (ex. CONFIDENTIEL)" value="CONFIDENTIEL"></div>
        <div class="pe-row"><label>OU LOGO <input type="file" id="wm-img" accept="image/*" style="max-width:160px"></label></div>
        <div class="pe-row"><label>OPACITÉ <input type="range" id="wm-op" min="5" max="100" value="18"></label><label>ANGLE <input type="number" id="wm-ang" value="45" style="width:60px"></label></div>
        <div class="pe-row"><label>TAILLE <input type="number" id="wm-size" value="64" style="width:60px"></label>${colorRow("wm-col", "#808080", "COULEUR")}</div>
        <div class="pe-row"><input type="text" id="wm-pages" placeholder="pages (vide = toutes)"><button class="btn on" id="wm-go">APPLIQUER</button></div>`)}
      ${sec("NUMÉROTATION DES PAGES", `<div class="pe-row"><input type="text" id="pn-fmt" value="Page {n}/{N}"></div>${note("{n} = numéro de page · {N} = total")}
        <div class="pe-row"><select id="pn-pos"><option value="bottom-center">Bas centré</option><option value="bottom-right">Bas droite</option><option value="bottom-left">Bas gauche</option><option value="top-center">Haut centré</option><option value="top-right">Haut droite</option><option value="top-left">Haut gauche</option></select>
        <label>TAILLE <input type="number" id="pn-size" value="10" style="width:56px"></label></div>
        <div class="pe-row"><label>DÉBUT <input type="number" id="pn-start" value="1" style="width:56px"></label><label><input type="checkbox" id="pn-skip"> sauf page 1</label></div>
        <div class="pe-row"><input type="text" id="pn-pages" placeholder="pages (vide = toutes)"><button class="btn on" id="pn-go">APPLIQUER</button></div>`)}
      ${sec("CONVERTIR", `${note("PDF vers un document modifiable. Pour Word / Excel / PowerPoint → PDF, ajoutez simplement le fichier avec « + AJOUTER / FUSIONNER » " + (t.office_in ? "" : "(nécessite LibreOffice, introuvable ici)") + ".")}
        <div class="pe-row"><button class="btn" data-conv="docx" ${t.docx ? "" : "disabled"}>→ WORD</button><button class="btn" data-conv="xlsx" ${t.xlsx ? "" : "disabled"}>→ EXCEL</button><button class="btn" data-conv="pptx" ${t.pptx ? "" : "disabled"}>→ POWERPOINT</button></div>
        ${note("Excel : les tableaux détectés deviennent des feuilles. Un document scanné doit d'abord passer par l'OCR.")}`)}`;
  }

  function panelSecu() {
    return `${sec("PROTÉGER PAR MOT DE PASSE", `${note("Crée une <b>copie chiffrée</b> (AES-256) dans Livraison ; le document en cours d'édition reste modifiable.")}
      <div class="pe-row col"><label>MOT DE PASSE D'OUVERTURE<input type="password" id="sc-user" autocomplete="new-password" placeholder="vide = ouverture libre"></label>
      <label>MOT DE PASSE PROPRIÉTAIRE<input type="password" id="sc-owner" autocomplete="new-password" placeholder="levé les restrictions (généré si vide)"></label></div>
      <div class="pe-row col"><label><input type="checkbox" id="sc-print" checked> autoriser l'impression</label><label><input type="checkbox" id="sc-copy" checked> autoriser la copie du texte</label><label><input type="checkbox" id="sc-mod" checked> autoriser la modification</label></div>
      <button class="btn on" id="sc-go">CRÉER LA COPIE PROTÉGÉE</button>`, true)}
      ${sec("DÉVERROUILLER", note("Un PDF protégé demande son mot de passe quand vous l'ajoutez : il est ensuite édité sans protection (vous devez connaître le mot de passe)."))}
      ${sec("CAVIARDAGE DÉFINITIF", note("Onglet « ÉDITER · CAVIARDER » : suppression irréversible du texte, des pixels et des métadonnées. Pensez à protéger la copie finale si elle contient d'autres données sensibles."))}`;
  }

  function panelAi() {
    const t = tools();
    const warn = !t.llm ? `<div class="pe-warn">L'IA n'est pas configurée : ajoutez <b>llm_api_key</b> dans nasko_config.json (voir GUIDE.md).</div>` : "";
    const scan = doc && !doc.has_text ? `<div class="pe-warn">Aucun texte détecté (document scanné ?). Lancez d'abord l'OCR (onglet OUTILS).</div>` : "";
    return `${warn}${scan}
      <div class="pe-box"><h4>CHAT AVEC LE DOCUMENT</h4><div class="pe-chat" id="ai-chat">${chat.length ? chat.map((m) => `<div class="pe-msg q">${esc(m.q)}</div><div class="pe-msg a">${esc(m.a)}</div>`).join("") : `<div class="pe-msg w">Posez une question : « Quelle est la date de fin de ce contrat ? », « Quels sont les montants ? »…</div>`}</div>
        <div class="pe-row"><input type="text" id="ai-q" placeholder="Votre question…" maxlength="1500"><button class="btn on" id="ai-send" ${t.llm ? "" : "disabled"}>ENVOYER</button></div>${note("Le texte pertinent du document est envoyé au LLM configuré.")}</div>
      ${sec("RÉSUMÉ AUTOMATIQUE", `<div class="pe-row"><select id="ai-len"><option value="short">Court (quelques lignes)</option><option value="standard" selected>Synthèse structurée</option><option value="detailed">Détaillé</option></select><button class="btn on" id="ai-sum" ${t.llm ? "" : "disabled"}>RÉSUMER</button></div><div id="ai-sumres">${sumText ? `<div class="pe-result">${esc(sumText)}</div><div class="pe-row"><button class="btn" id="ai-copy">COPIER</button></div>` : ""}</div>`, true)}
      ${sec("TRADUIRE EN GARDANT LA MISE EN PAGE", `${note("Chaque bloc de texte est remplacé par sa traduction au même endroit (police, taille, couleur reprises) ; images et graphiques sont conservés. Résultat enregistré en nouveau PDF.")}
        <div class="pe-row"><select id="ai-lang"><option value="en">Anglais</option><option value="fr">Français</option><option value="es">Espagnol</option><option value="de">Allemand</option><option value="it">Italien</option><option value="pt">Portugais</option><option value="nl">Néerlandais</option><option value="ar">Arabe</option><option value="zh">Chinois</option><option value="ja">Japonais</option><option value="ru">Russe</option><option value="tr">Turc</option><option value="pl">Polonais</option></select><button class="btn on" id="ai-tr" ${t.llm ? "" : "disabled"}>TRADUIRE</button></div>`)}`;
  }
  let sumText = "";

  function renderPanel() {
    if (!hasDoc()) return;
    const p = $("pe-panel");
    const keep = p.scrollTop;
    p.innerHTML = ({ pages: panelPages, annot: panelAnnot, edit: panelEdit, sign: panelSign, tools: panelTools, secu: panelSecu, ai: panelAi }[tab] || panelPages)();
    p.scrollTop = keep;
    bindPanel();
  }

  const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
  const val = (id) => ($(id) ? $(id).value : "");

  function bindPanel() {
    const p = $("pe-panel");
    p.querySelectorAll("[data-tool]").forEach((b) => (b.onclick = () => { tool = b.dataset.tool; opt.color = { highlight: "#ffeb3b", text: "#000000" }[tool] || "#e53935"; if (tool === "edittext") loadLines(); render(); }));
    p.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { pending.splice(+b.dataset.rm, 1); drawOps(); renderPanel(); status(); }));
    on("pe-apply", applyPending); on("pe-drop", () => { pending = []; drawOps(); renderPanel(); status(); });
    // pages
    on("pg-l", () => rotateSel(-90)); on("pg-r", () => rotateSel(90)); on("pg-f", () => rotateSel(180));
    on("pg-dup", () => dupIdx([...sel])); on("pg-del", () => deleteIdx([...sel])); on("pg-blank", blankAfter);
    on("pg-all", () => { arr.forEach((_, i) => sel.add(i)); renderGrid(); renderPanel(); status(); });
    on("pg-odd", () => { sel.clear(); arr.forEach((_, i) => i % 2 === 0 && sel.add(i)); renderGrid(); renderPanel(); status(); });
    on("pg-even", () => { sel.clear(); arr.forEach((_, i) => i % 2 === 1 && sel.add(i)); renderGrid(); renderPanel(); status(); });
    on("pg-apply", flushArr); on("pg-reset", () => { arr = doc.pages.map((_, i) => ({ src: i, rot: 0 })); arrDirty = false; sel.clear(); renderGrid(); renderPanel(); status(); });
    on("ex-go", async () => { if (!(await flushArr())) return; try { const r = await api("/api/pdf/extract", { body: { pages: val("ex-spec") } }); showFiles("PAGES EXTRAITES", r.files); } catch (e) { toast(e.message, true); } });
    const spm = $("sp-mode");
    if (spm) {
      const upd = () => { const v = $("sp-val"); v.hidden = !["every", "ranges"].includes(spm.value); v.placeholder = spm.value === "every" ? "nombre de pages par fichier (ex. 5)" : "ex. 1-3; 4-6; 7-"; };
      spm.onchange = upd; upd();
      on("sp-go", async () => { if (!(await flushArr())) return; try { const r = await api("/api/pdf/split", { body: { mode: spm.value, value: val("sp-val") } }); showFiles("DOCUMENT DIVISÉ", r.files, `${r.files.length - 1} fichier(s) + une archive ZIP.`); } catch (e) { toast(e.message, true); } });
    }
    // annotation
    const oc = $("o-color"); if (oc) oc.oninput = () => (opt.color = oc.value);
    const os = $("o-size"); if (os) os.oninput = () => (opt.size = clamp(+os.value || 14, 6, 120));
    const ob = $("o-bold"); if (ob) ob.onchange = () => (opt.bold = ob.checked);
    const of = $("o-fam"); if (of) of.onchange = () => (opt.family = of.value);
    const ow = $("o-width"); if (ow) ow.oninput = () => (opt.width = +ow.value);
    const sc = $("o-scolor"); if (sc) sc.oninput = () => (opt.stampColor = sc.value);
    const sl = $("o-label"); if (sl) sl.oninput = () => (opt.label = sl.value || "APPROUVÉ");
    const st = $("o-stamps"); if (st) st.querySelectorAll("button").forEach((b) => (b.onclick = () => { opt.label = b.textContent; const col = { "APPROUVÉ": "#1b8a3a", "VÉRIFIÉ": "#1b8a3a" }[b.textContent]; opt.stampColor = col || "#cc0000"; renderPanel(); }));
    // caviardage par recherche
    const rp = $("rs-presets"); if (rp) rp.querySelectorAll("button").forEach((b) => (b.onclick = () => {
      pending.push({ type: "redact_text", preset: b.dataset.p, pages: val("rs-pages") }); renderPanel(); status(); toast("Ajouté : tous les « " + b.textContent + " » seront caviardés à l'application.");
    }));
    on("rs-add", () => { const q = val("rs-q").trim(); if (!q) return toast("Indiquez le texte à caviarder.", true); pending.push({ type: "redact_text", query: q, pages: val("rs-pages") }); $("rs-q").value = ""; renderPanel(); status(); });
    // signature
    if (tab === "sign") signUi();
    // outils
    on("cp-go", () => runJob("compress", { level: val("cp-lvl") }, "COMPRESSION"));
    on("oc-go", () => runJob("ocr", { lang: val("oc-lang"), force: $("oc-force").checked }, "OCR"));
    on("wm-go", doWatermark); on("pn-go", doNumbers);
    p.querySelectorAll("[data-conv]").forEach((b) => (b.onclick = () => runJob("convert", { fmt: b.dataset.conv }, "CONVERSION")));
    // sécurité
    on("sc-go", async () => {
      if (!(await guard())) return;
      try { const r = await api("/api/pdf/protect", { body: { user_pw: val("sc-user"), owner_pw: val("sc-owner"), allow_print: $("sc-print").checked, allow_copy: $("sc-copy").checked, allow_modify: $("sc-mod").checked } }); showFiles("COPIE PROTÉGÉE", r.files, "Conservez bien vos mots de passe : ils ne peuvent pas être récupérés."); } catch (e) { toast(e.message, true); }
    });
    // IA
    on("ai-send", sendChat); const q = $("ai-q"); if (q) q.onkeydown = (e) => { if (e.key === "Enter") sendChat(); };
    on("ai-sum", () => runJob("summarize", { length: val("ai-len") }, "RÉSUMÉ"));
    on("ai-tr", () => runJob("translate", { lang: val("ai-lang") }, "TRADUCTION"));
    on("ai-copy", () => { try { navigator.clipboard.writeText(sumText); toast("Résumé copié."); } catch (e) { toast("Copie impossible : sélectionnez le texte.", true); } });
    const ch = $("ai-chat"); if (ch) ch.scrollTop = ch.scrollHeight;
  }

  // ------------------------------------------------------------------ signature
  function signUi() {
    const pane = $("sg-pane"); let mode = "draw", cv = null, ctx = null, typed = "", imgData = null;
    const mount = () => {
      document.querySelectorAll("#sg-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.m === mode));
      if (mode === "draw") {
        pane.innerHTML = `<canvas class="pe-sigc" id="sg-cv" width="600" height="200"></canvas><div class="pe-row">${colorRow("sg-col", "#101a6e", "ENCRE")}<label>TRAIT <input type="range" id="sg-w" min="2" max="10" value="4"></label></div>`;
        cv = $("sg-cv"); ctx = cv.getContext("2d"); let down = false;
        const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
        cv.onpointerdown = (e) => { down = true; cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.strokeStyle = $("sg-col").value; ctx.lineWidth = +$("sg-w").value; ctx.lineCap = ctx.lineJoin = "round"; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke(); };
        cv.onpointermove = (e) => { if (!down) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); };
        cv.onpointerup = cv.onpointercancel = () => (down = false);
      } else if (mode === "type") {
        pane.innerHTML = `<div class="pe-row col"><input type="text" id="sg-txt" placeholder="Tapez votre nom" maxlength="40" value="${esc(typed)}"><select id="sg-font"><option value="'Segoe Script','Brush Script MT','Snell Roundhand',cursive">Manuscrit 1</option><option value="'Lucida Handwriting','Apple Chancery',cursive">Manuscrit 2</option><option value="'Ink Free','Bradley Hand',cursive">Manuscrit 3</option><option value="'Times New Roman',serif">Classique</option></select>${colorRow("sg-col", "#101a6e", "ENCRE")}</div><canvas class="pe-sigc" id="sg-cv" width="600" height="200"></canvas>`;
        cv = $("sg-cv"); ctx = cv.getContext("2d");
        const draw = () => { typed = $("sg-txt").value; ctx.clearRect(0, 0, cv.width, cv.height); ctx.fillStyle = $("sg-col").value; ctx.font = `italic 80px ${$("sg-font").value}`; ctx.textBaseline = "middle"; ctx.fillText(typed, 20, 105, 560); };
        ["sg-txt", "sg-font", "sg-col"].forEach((i) => ($(i).oninput = draw)); draw();
      } else {
        pane.innerHTML = `<div class="pe-row col"><input type="file" id="sg-file" accept="image/*"><label><input type="checkbox" id="sg-bg" checked> rendre le fond blanc transparent</label></div><canvas class="pe-sigc" id="sg-cv" width="600" height="200" style="background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/16px 16px"></canvas>`;
        cv = $("sg-cv"); ctx = cv.getContext("2d");
        const redraw = () => {
          ctx.clearRect(0, 0, cv.width, cv.height); if (!imgData) return;
          const k = Math.min(cv.width / imgData.width, cv.height / imgData.height); const w = imgData.width * k, h = imgData.height * k;
          ctx.drawImage(imgData, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
          if ($("sg-bg").checked) { const d = ctx.getImageData(0, 0, cv.width, cv.height), px = d.data; for (let i = 0; i < px.length; i += 4) { const m = Math.min(px[i], px[i + 1], px[i + 2]); if (m > 200) px[i + 3] = Math.max(0, 255 - (m - 200) * 4.6); } ctx.putImageData(d, 0, 0); }
        };
        $("sg-bg").onchange = redraw;
        $("sg-file").onchange = (e) => { const f = e.target.files[0]; if (!f) return; const im = new Image(); im.onload = () => { imgData = im; redraw(); }; im.onerror = () => toast("Image illisible.", true); im.src = URL.createObjectURL(f); };
      }
    };
    document.querySelectorAll("#sg-tabs button").forEach((b) => (b.onclick = () => { mode = b.dataset.m; mount(); }));
    on("sg-clear", () => { if (ctx) ctx.clearRect(0, 0, cv.width, cv.height); imgData = null; if (mode === "type" && $("sg-txt")) { $("sg-txt").value = ""; typed = ""; } });
    on("sg-use", () => {
      const r = trimCanvas(cv);
      if (!r) return toast("La signature est vide.", true);
      sig = r; tool = "sigplace"; try { localStorage.setItem("pe_sig", JSON.stringify(r)); } catch (e) {}
      render(); toast("Signature prête : cliquez sur la page pour la placer.");
    });
    mount();
  }

  function trimCanvas(c) {
    const ctx = c.getContext("2d"), d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0 || y1 <= y0) return null;
    const pad = 6, w = x1 - x0 + 1 + pad * 2, h = y1 - y0 + 1 + pad * 2, o = document.createElement("canvas");
    o.width = w; o.height = h; o.getContext("2d").drawImage(c, x0 - pad, y0 - pad, w, h, 0, 0, w, h);
    return { data: o.toDataURL("image/png"), w, h };
  }

  // ------------------------------------------------------------------ outils : filigrane, numérotation
  function fileToDataUrl(f) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Image illisible.")); r.readAsDataURL(f); });
  }
  async function doWatermark() {
    if (!(await guard())) return;
    try {
      const f = $("wm-img").files[0];
      const opts = { text: val("wm-text"), opacity: +val("wm-op") / 100, angle: +val("wm-ang") || 0, size: +val("wm-size") || 64, color: val("wm-col"), pages: val("wm-pages") };
      if (f) { opts.image = await fileToDataUrl(f); opts.text = ""; opts.scale = 0.5; }
      busy = true; const st = await api("/api/pdf/watermark", { body: { opts } }); busy = false;
      await refresh(st); toast("Filigrane ajouté.");
    } catch (e) { busy = false; toast(e.message, true); }
  }
  async function doNumbers() {
    if (!(await guard())) return;
    try {
      busy = true;
      const st = await api("/api/pdf/numbers", { body: { opts: { format: val("pn-fmt"), position: val("pn-pos"), size: +val("pn-size") || 10, start: parseInt(val("pn-start"), 10) || 1, skip_first: $("pn-skip").checked, pages: val("pn-pages") } } });
      busy = false; await refresh(st); toast("Numérotation ajoutée.");
    } catch (e) { busy = false; toast(e.message, true); }
  }

  // ------------------------------------------------------------------ tâches longues
  async function runJob(kind, body, label) {
    if (!(await guard())) return;
    $("pe-jt").textContent = label; $("pe-js").textContent = "Démarrage…"; $("pe-jb").style.width = "2%"; $("pe-job").hidden = false;
    try { await api("/api/pdf/job/" + kind, { body }); } catch (e) { $("pe-job").hidden = true; return toast(e.message, true); }
    let j;
    for (;;) {
      await wait(450);
      try { j = await api("/api/pdf/job"); } catch (e) { $("pe-job").hidden = true; return toast(e.message, true); }
      $("pe-js").textContent = j.stage || ""; $("pe-jb").style.width = Math.max(2, j.progress) + "%";
      if (!j.busy) break;
    }
    $("pe-job").hidden = true;
    if (j.error) return toast(j.error, true);
    const r = j.result || {};
    if (r.kind === "compress" || r.kind === "ocr") await refresh();
    if (r.kind === "compress") {
      if (!r.kept) return toast(r.message, true);
      const saved = Math.round((1 - r.after / r.before) * 100);
      const box = $("cp-res"); if (box) box.innerHTML = `<div class="pe-cmp"><span>${bytes(r.before)}</span>→<b>${bytes(r.after)}</b><span class="ok">−${saved} %</span></div>`;
      toast(`Compressé : ${bytes(r.before)} → ${bytes(r.after)} (−${saved} %).`);
    } else if (r.kind === "ocr") {
      toast(r.pages ? `OCR terminé : ${r.pages} page${r.pages > 1 ? "s" : ""} rendue${r.pages > 1 ? "s" : ""} cherchable${r.pages > 1 ? "s" : ""}.` : "Aucune page à traiter (toutes ont déjà du texte).");
      renderPanel();
    } else if (r.kind === "text") {
      sumText = r.text; renderPanel();
    } else if (r.kind === "files") {
      let n = ""; if (r.skipped_rotated) n = `${r.skipped_rotated} page(s) pivotée(s) non traduite(s) : appliquez d'abord la rotation puis réessayez.`;
      showFiles(label === "TRADUCTION" ? "DOCUMENT TRADUIT" : "FICHIER CONVERTI", r.files, n);
    }
  }
  async function cancelJob() { try { await api("/api/pdf/job/cancel", { body: {} }); } catch (e) {} }

  async function sendChat() {
    const inp = $("ai-q"); const q = inp.value.trim(); if (!q) return;
    inp.value = ""; $("ai-send").disabled = true;
    const box = $("ai-chat");
    if (box) { box.insertAdjacentHTML("beforeend", `<div class="pe-msg q">${esc(q)}</div><div class="pe-msg a w" id="ai-wait">E.N.O.S. lit le document…</div>`); box.scrollTop = box.scrollHeight; }
    try {
      const r = await api("/api/pdf/chat", { body: { question: q, history: chat.slice(-6) } });
      chat.push({ q, a: r.answer });
    } catch (e) { toast(e.message, true); }
    if (tab === "ai") renderPanel();
  }

  // ------------------------------------------------------------------ ajout de fichiers
  async function sendFiles(files, password, replace) {
    if (!files.length) return;
    if (!(await guard())) return;
    lastFiles = { files, replace };
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    fd.append("password", password || ""); fd.append("replace", replace ? "1" : "");
    $("pe-jt").textContent = "OUVERTURE"; $("pe-js").textContent = files.length > 1 ? `Fusion de ${files.length} fichiers…` : files[0].name; $("pe-jb").style.width = "40%"; $("pe-job").hidden = false;
    $("pe-jx").hidden = true;
    try {
      const st = await api("/api/pdf/upload", { body: fd });
      $("pe-job").hidden = true; $("pe-jx").hidden = false; lastFiles = null;
      cur = replace || !hasDoc() ? 0 : cur;
      await refresh(st); if (tab !== "pages" && !VIEWER_TABS.includes(tab)) tab = "pages"; render();
      toast(files.length > 1 ? `${files.length} fichiers fusionnés.` : "Fichier ajouté.");
    } catch (e) {
      $("pe-job").hidden = true; $("pe-jx").hidden = false;
      if (/^PASSWORD:/.test(e.message)) {
        const name = e.message.slice(9);
        const pw = await modal("PDF PROTÉGÉ", `<p class="pe-p">« ${esc(name)} » est protégé par mot de passe.</p><input type="password" id="pe-pw" autocomplete="off" placeholder="Mot de passe">`,
          [{ label: "ANNULER", value: null }, { label: "DÉVERROUILLER", value: () => $("pe-pw").value, cls: "on" }], (done) => { const i = $("pe-pw"); i.focus(); i.onkeydown = (ev) => { if (ev.key === "Enter") done(i.value); }; });
        if (pw) return sendFiles(files, pw, replace);
        return;
      }
      toast(e.message, true);
    }
  }

  function pickFiles() { $("pe-file").click(); }

  // ------------------------------------------------------------------ init
  function init() {
    $("b-pdf").onclick = open;
    $("pe-close").onclick = close;
    $("pe-pick").onclick = pickFiles;
    $("pe-add").onclick = pickFiles;
    $("pe-file").onchange = (e) => { const f = [...e.target.files]; e.target.value = ""; sendFiles(f, "", false); };
    $("pe-undo").onclick = async () => {
      if (pending.length || arrDirty) { if (!(await ask("ANNULER LES CHANGEMENTS EN COURS", "Les modifications non appliquées seront abandonnées.", "ABANDONNER", "danger"))) return; pending = []; arrDirty = false; return syncDoc(); }
      try { await refresh(await api("/api/pdf/undo", { body: {} })); toast("Version précédente rétablie."); } catch (e) { toast(e.message, true); }
    };
    $("pe-save").onclick = async () => {
      if (!(await guard())) return;
      try { const r = await api("/api/pdf/export", { body: {} }); showFiles("DOCUMENT ENREGISTRÉ", r.files); } catch (e) { toast(e.message, true); }
    };
    $("pe-new").onclick = async () => {
      if (!(await ask("NOUVEAU DOCUMENT", "Fermer ce document ? Pensez à l'enregistrer d'abord (⬇ ENREGISTRER) : l'historique d'annulation sera perdu.", "FERMER LE DOCUMENT", "danger"))) return;
      pending = []; arrDirty = false; chat = []; sumText = "";
      try { await refresh(await api("/api/pdf/new", { body: {} })); } catch (e) { toast(e.message, true); }
    };
    document.querySelectorAll("#pe-tabs button").forEach((b) => (b.onclick = () => setTab(b.dataset.t)));
    $("pe-jx").onclick = cancelJob;
    gridEvents(); overlayEvents();
    $("pe-prev").onclick = () => go(cur - 1); $("pe-next").onclick = () => go(cur + 1);
    $("pe-pnum").onchange = () => go((parseInt($("pe-pnum").value, 10) || 1) - 1);
    $("pe-zoom").oninput = (e) => { zoom = +e.target.value / 100; renderViewer(); };
    window.addEventListener("resize", () => { if (isOpen() && hasDoc() && VIEWER_TABS.includes(tab)) renderViewer(); });
    try { const s = JSON.parse(localStorage.getItem("pe_sig") || "null"); if (s && /^data:image\/png;base64,/.test(s.data)) sig = s; } catch (e) {}
    // dépôt de fichiers (les glisser-déposer internes des pages n'ont pas le type « Files »)
    const pe = $("pe"); let depth = 0;
    const isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    pe.addEventListener("dragenter", (e) => { if (isFiles(e)) { depth++; pe.classList.add("drag"); } });
    pe.addEventListener("dragleave", (e) => { if (isFiles(e) && --depth <= 0) { depth = 0; pe.classList.remove("drag"); } });
    pe.addEventListener("dragover", (e) => { if (isFiles(e)) e.preventDefault(); });
    pe.addEventListener("drop", (e) => { if (!isFiles(e)) return; e.preventDefault(); depth = 0; pe.classList.remove("drag"); sendFiles([...e.dataTransfer.files], "", false); });
    document.addEventListener("keydown", (e) => {
      if (!isOpen()) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === "Escape" && !$("pe-modal").hidden) return;
      if (e.key === "Escape" && !typing) close();
      else if (!typing && VIEWER_TABS.includes(tab) && hasDoc()) {
        if (e.key === "PageDown" || e.key === "ArrowRight") go(cur + 1); else if (e.key === "PageUp" || e.key === "ArrowLeft") go(cur - 1);
        else if (e.key === "Delete" && pending.length) { pending.pop(); drawOps(); renderPanel(); status(); }
      } else if (!typing && tab === "pages" && (e.key === "Delete") && sel.size) deleteIdx([...sel]);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing && hasDoc()) { e.preventDefault(); $("pe-undo").click(); }
    });
  }

  function go(n) { n = clamp(n, 0, doc.pages.length - 1); if (n === cur) { $("pe-pnum").value = cur + 1; return; } cur = n; renderViewer(); renderPanel(); }

  init();
})();
