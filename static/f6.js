"use strict";
/* ============================================================================
   PANEL TESTS F6 : transition « grille numérique », cartes de scènes, visu en direct, lancement/arrêt.
   Utilise les globaux de app.js : api, $, say, sayRef, sfx, TOKEN, muted, actx, current, line, sceneBusy.
   ========================================================================== */
(() => {
  const V = $("f6view");
  const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isRemote = () => document.body.classList.contains("remote");
  const S = { open: false, busy: false, scenes: [], loaded: false, filter: "", chip: "all", groups: new Set([""]), recents: [], st: null,
              timer: null, q: "normal", streaming: false, imgOk: false, retry: null, launching: false, offset: 0, fails: 0 };
  try { S.recents = JSON.parse(localStorage.getItem("nasko_f6_recents") || "[]"); S.q = localStorage.getItem("nasko_f6_q") || "normal"; } catch (e) {}
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  // ---------------------------------------------------------------- sons (synthèse WebAudio)
  function whoosh(up) {
    if (muted || (navigator.userActivation && !navigator.userActivation.hasBeenActive)) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime, len = 0.95, buf = actx.createBuffer(1, Math.floor(actx.sampleRate * len), actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = actx.createBufferSource(); src.buffer = buf;
      const f = actx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 2.5;
      f.frequency.setValueAtTime(up ? 260 : 3200, t); f.frequency.exponentialRampToValueAtTime(up ? 3600 : 240, t + 0.7);
      const g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.14); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      src.connect(f); f.connect(g); g.connect(actx.destination); src.start(t);
      beep(up ? 70 : 90, 260, "sine", 0.12, 380);                          // grave d'impact à l'instant du changement de vue
      beep(up ? 1800 : 900, 60, "square", 0.03, 560);
    } catch (e) {}
  }

  // ---------------------------------------------------------------- transition : grille de cellules numériques
  function transition({ x, y, label, sub }, swap) {
    if (REDUCE) { swap(); return Promise.resolve(); }
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
    const cvs = document.createElement("canvas"); cvs.id = "fx";
    cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr); cvs.style.width = W + "px"; cvs.style.height = H + "px";
    document.body.appendChild(cvs);
    const ctx = cvs.getContext("2d"); ctx.scale(dpr, dpr);
    const cell = Math.max(44, Math.round(Math.min(W, H) / 9)), cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
    const ox = x == null ? W / 2 : x, oy = y == null ? H / 2 : y, maxD = Math.hypot(Math.max(ox, W - ox), Math.max(oy, H - oy));
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const cx = c * cell + cell / 2, cy = r * cell + cell / 2;
      cells.push({ cx, cy, d: Math.hypot(cx - ox, cy - oy) / maxD, j: Math.random() });
    }
    const A = 470, HOLD = 300, B = 560, T = A + HOLD + B;
    const t0 = performance.now(); let swapped = false;
    const hex = () => Math.floor(Math.random() * 65535).toString(16).toUpperCase().padStart(4, "0");
    return new Promise((resolve) => {
      function frame(now) {
        const t = now - t0;
        if (t >= T) { cvs.remove(); resolve(); return; }
        ctx.clearRect(0, 0, W, H);
        const phase = t < A ? "A" : t < A + HOLD ? "H" : "B";
        if (phase === "H" && !swapped) { swapped = true; swap(); }                // la vue change quand tout est recouvert
        const tt = phase === "A" ? t : phase === "H" ? t - A : t - A - HOLD;
        for (const c of cells) {
          let a;
          if (phase === "A") a = clamp((tt - (c.d * 0.6 + c.j * 0.14) * A * 0.85) / (A * 0.34));
          else if (phase === "H") a = 1;
          else a = 1 - clamp((tt - (c.d * 0.55 + c.j * 0.2) * B * 0.7) / (B * 0.3));
          if (a <= 0.004) continue;
          const s = 0.4 + 0.6 * ease(a), w = cell * s;
          const flash = Math.sin(clamp(a) * Math.PI);                           // 0 -> 1 -> 0 : éclair néon au changement d'état
          ctx.fillStyle = "rgba(1,12,4," + (0.985 * a).toFixed(3) + ")";
          ctx.fillRect(c.cx - w / 2, c.cy - w / 2, w, w);
          if (flash > 0.72) { ctx.fillStyle = "rgba(150,255,185," + ((flash - 0.72) * 1.1).toFixed(3) + ")"; ctx.fillRect(c.cx - w / 2, c.cy - w / 2, w, w); }
          ctx.strokeStyle = "rgba(0,255,65," + (0.1 + 0.85 * flash).toFixed(3) + ")"; ctx.lineWidth = 1 + flash * 1.6;
          ctx.strokeRect(c.cx - w / 2 + 0.5, c.cy - w / 2 + 0.5, w - 1, w - 1);
          if (phase === "H" && c.j > 0.93 && Math.random() < 0.5) {              // cellules « données » qui scintillent
            ctx.fillStyle = "rgba(0,255,65,.55)"; ctx.font = "10px Consolas,monospace"; ctx.fillText(hex(), c.cx - 14, c.cy + 3);
          }
        }
        // onde de choc néon (ouverture puis dissipation) depuis le point de clic
        const rp = phase === "A" ? t / A : phase === "B" ? 1 + (t - A - HOLD) / B : 1;
        if (phase !== "H") {
          ctx.save(); ctx.strokeStyle = "rgba(120,255,160," + (phase === "A" ? 0.9 : 0.6 * (1 - (rp - 1))).toFixed(3) + ")"; ctx.lineWidth = 3;
          ctx.shadowColor = enosColor(); ctx.shadowBlur = 22; ctx.beginPath(); ctx.arc(ox, oy, ease(clamp(rp > 1 ? rp - 1 : rp)) * maxD * 1.08, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
        if (phase === "H") {                                                    // titre glitché + barre de chargement
          const k = tt / HOLD, cxm = W / 2, cym = H / 2, fs = Math.max(26, Math.min(64, W / 11));
          ctx.save(); ctx.font = "800 " + fs + "px Consolas,monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          try { ctx.letterSpacing = Math.round(fs / 4) + "px"; } catch (e) {}
          const jx = (Math.random() - 0.5) * 10 * (1 - k);
          ctx.fillStyle = "rgba(255,42,109,.75)"; ctx.fillText(label, cxm + 5 + jx, cym);
          ctx.fillStyle = "rgba(0,255,225,.75)"; ctx.fillText(label, cxm - 5 - jx, cym);
          ctx.shadowColor = enosColor(); ctx.shadowBlur = 24; ctx.fillStyle = enosColor(); ctx.fillText(label, cxm, cym);
          ctx.shadowBlur = 0; ctx.font = "700 " + Math.max(11, fs / 4.2) + "px Consolas,monospace"; ctx.fillStyle = enosColor(.7); ctx.fillText(sub, cxm, cym + fs * 0.85);
          const bw = Math.min(320, W * 0.6); ctx.strokeStyle = enosColor(.5); ctx.lineWidth = 1; ctx.strokeRect(cxm - bw / 2, cym + fs * 1.35, bw, 6);
          ctx.fillStyle = enosColor(); ctx.fillRect(cxm - bw / 2 + 1, cym + fs * 1.35 + 1, (bw - 2) * ease(k), 4);
          for (let i = 0; i < 3; i++) {                                         // tranches décalées (glitch)
            const gy = cym - fs / 2 + Math.random() * fs, gh = 3 + Math.random() * 7, gx = (Math.random() - 0.5) * 36;
            ctx.drawImage(cvs, 0, Math.round(gy * dpr), cvs.width, Math.round(gh * dpr), gx, gy, W, gh);
          }
          ctx.restore();
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  // ---------------------------------------------------------------- ouverture / fermeture du panel
  const originOf = (ev) => (ev && ev.clientX != null && ev.clientX > 0) ? { x: ev.clientX, y: ev.clientY }
    : (ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect ? (() => { const r = ev.currentTarget.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })() : {});

  async function openF6(ev) {
    if (S.open || S.busy) return;
    S.busy = true; whoosh(true);
    const o = originOf(ev);
    await transition({ ...o, label: "TESTS F6", sub: "MODE TEST  //  SCÈNES GODOT" }, () => {
      document.body.classList.add("f6-open"); V.hidden = false;
      V.classList.remove("enter"); void V.offsetWidth; V.classList.add("enter");
      S.open = true;
      try { history.pushState({ f6: 1 }, ""); } catch (e) {}
      onOpen();
    });
    S.busy = false;
  }

  async function closeF6(fromPop, ev) {
    if (!S.open || S.busy) return;
    S.busy = true; whoosh(false);
    const o = originOf(ev);
    await transition({ ...o, label: "CHAT IA", sub: "RETOUR AU TERMINAL DE DIALOGUE" }, () => {
      onClose();
      V.hidden = true; V.classList.remove("enter"); document.body.classList.remove("f6-open"); S.open = false;
    });
    if (!fromPop && history.state && history.state.f6) { try { history.back(); } catch (e) {} }
    S.busy = false;
  }
  window.addEventListener("popstate", () => { if (S.open && !(history.state && history.state.f6)) closeF6(true); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "F6") { e.preventDefault(); S.open ? closeF6() : openF6(); }
    else if (e.key === "Escape" && S.open && !document.fullscreenElement && !S.busy) closeF6();
  });
  $("b-f6").onclick = openF6;
  $("b-f6-mod").onclick = (e) => { openF6(e); };
  $("f6-back").onclick = (e) => closeF6(false, e);

  function onOpen() {
    loadScenes();
    pollNow();
    clearInterval(S.timer); S.timer = setInterval(() => { if (!document.hidden) pollNow(); }, 2000);
    $("f6-q").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.q === S.q));
  }
  function onClose() { clearInterval(S.timer); S.timer = null; disconnect(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
  document.addEventListener("visibilitychange", () => { if (!S.open) return; if (document.hidden) disconnect(); else pollNow(); });

  // ---------------------------------------------------------------- notifications
  let toastT = null;
  function toast(msg, err) {
    const t = $("f6-toast"); t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), err ? 4200 : 2600);
  }

  // ---------------------------------------------------------------- liste des scènes (un bouton par scène)
  async function loadScenes() {
    const qs = (!isRemote() && typeof current === "string" && current) ? "?project=" + encodeURIComponent(current) : "";
    try {
      const r = await api("/api/godot/scenes" + qs);
      S.loaded = true; S.err = r.ok ? null : (r.message || "Projet introuvable"); S.scenes = r.ok ? r.scenes : [];
    } catch (e) { S.loaded = true; S.err = e.message; S.scenes = []; }
    renderChips(); renderGrid();
  }
  const nameOf = (sc) => sc.name.replace(/\.tscn$/i, "");
  // ---- catégorie = premier dossier du projet ; sous-catégorie = le reste du chemin
  const catOf = (sc) => sc.dir.split("/")[0] || "";
  const subOf = (sc) => sc.dir.split("/").slice(1).join("/");
  const catLabel = (c) => c === "" ? "RACINE" : c.replace(/[_-]+/g, " ").toUpperCase();
  const hueOf = (c) => { if (c === "") return 130; let h = 7; for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) % 360; return 20 + (h * 7) % 320; };
  const norm = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const terms = () => norm(S.filter).split(/\s+/).filter(Boolean);
  function hl(el, text, ts) {
    el.textContent = "";
    if (!ts.length) { el.textContent = text; return; }
    const n = norm(text), marks = new Array(text.length).fill(false);
    ts.forEach((t) => { let i = n.indexOf(t); while (i >= 0) { for (let k = i; k < i + t.length && k < marks.length; k++) marks[k] = true; i = n.indexOf(t, i + t.length); } });
    let i = 0;
    while (i < text.length) {
      let j = i; while (j < text.length && marks[j] === marks[i]) j++;
      const seg = text.slice(i, j);
      if (marks[i]) { const m = document.createElement("mark"); m.textContent = seg; el.appendChild(m); } else el.appendChild(document.createTextNode(seg));
      i = j;
    }
  }
  const byRacineLast = (a, b) => (a === "") - (b === "") || a.localeCompare(b);
  function cats() {
    const m = new Map(); S.scenes.forEach((s) => m.set(catOf(s), (m.get(catOf(s)) || 0) + 1));
    return [...m.entries()].sort((a, b) => byRacineLast(a[0], b[0]));
  }
  function renderChips() {
    const has = (re) => S.scenes.some((s) => re.test(s.name));
    const defs = [["all", "TOUT", S.scenes.length]];
    if (S.recents.length) defs.push(["recent", "RÉCENTS", S.recents.length]);
    if (has(/test/i)) defs.push(["test", "TEST", null]);
    if (has(/diag/i)) defs.push(["diag", "DIAG", null]);
    cats().forEach(([c, n]) => defs.push(["cat:" + c, catLabel(c), n, c]));
    if (!defs.some((d) => d[0] === S.chip)) S.chip = "all";
    const box = $("f6-chips"); box.textContent = "";
    defs.forEach(([id, label, n, c]) => {
      const b = document.createElement("button"); b.textContent = label; b.classList.toggle("on", S.chip === id);
      if (n != null) { const s = document.createElement("i"); s.textContent = n; b.appendChild(s); }
      if (c !== undefined) b.style.setProperty("--c", hueOf(c));
      b.onclick = () => { S.chip = id; renderChips(); renderGrid(); }; box.appendChild(b);
    });
  }
  function visible() {
    const ts = terms();
    return S.scenes.filter((s) => {
      if (S.chip === "recent" && !S.recents.includes(s.rel)) return false;
      if (S.chip === "test" && !/test/i.test(s.name)) return false;
      if (S.chip === "diag" && !/diag/i.test(s.name)) return false;
      if (S.chip.startsWith("cat:") && catOf(s) !== S.chip.slice(4)) return false;
      if (!ts.length) return true;
      const hay = norm(s.name + " " + s.dir + " " + catLabel(catOf(s)));
      return ts.every((t) => hay.includes(t));
    });
  }
  S.folded = new Set();
  function renderGrid() {
    const grid = $("f6-grid"), list = visible(), ts = terms(), searching = ts.length > 0 || S.chip === "recent";
    grid.textContent = "";
    $("f6-clear").hidden = !S.filter;
    $("f6-count").textContent = S.scenes.length ? (list.length === S.scenes.length ? S.scenes.length + " SCÈNES · " + cats().length + " CATÉGORIES" : list.length + " / " + S.scenes.length + " SCÈNES") : "";
    if (!list.length) {
      const d = document.createElement("div"); d.className = "f6-empty";
      d.textContent = S.err ? "⚠ " + S.err : S.scenes.length ? "Aucune scène ne correspond à « " + S.filter.trim() + " »." : S.loaded ? "Aucune scène .tscn dans ce projet." : "Analyse du projet…";
      grid.appendChild(d); return;
    }
    const byCat = new Map();
    list.forEach((s) => { const c = catOf(s); if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(s); });
    const order = [...byCat.keys()].sort(byRacineLast);
    const runRel = S.st && S.st.running && S.st.running[0] ? S.st.running[0].rel : null;
    let idx = 0;
    order.forEach((c) => {
      const items = byCat.get(c), fixed = searching || order.length === 1;
      const open = fixed || !S.folded.has(c);
      const g = document.createElement("div"); g.className = "f6-group" + (open ? " open" : ""); g.style.setProperty("--c", hueOf(c));
      const h = document.createElement("div"); h.className = "f6-gh";
      h.innerHTML = "<span class='ch'>▸</span><span class='t'></span><span class='n'></span>";
      h.children[1].textContent = catLabel(c); h.children[2].textContent = items.length + (items.length > 1 ? " scènes" : " scène");
      h.onclick = () => { if (fixed) return; S.folded.has(c) ? S.folded.delete(c) : S.folded.add(c); renderGrid(); };
      g.appendChild(h);
      const body = document.createElement("div"); body.className = "f6-cbody";
      if (open) {
        const subs = new Map();
        items.forEach((s) => { const k = subOf(s); if (!subs.has(k)) subs.set(k, []); subs.get(k).push(s); });
        [...subs.keys()].sort(byRacineLast).forEach((k) => {
          if (subs.size > 1 || k) {
            const sh = document.createElement("div"); sh.className = "f6-sh";
            sh.textContent = (k === "" ? "· généralités" : k.replace(/\//g, "  ›  ")) + "  (" + subs.get(k).length + ")"; body.appendChild(sh);
          }
          const cards = document.createElement("div"); cards.className = "f6-cards";
          subs.get(k).forEach((sc) => {
            const b = document.createElement("button"); b.className = "f6-card" + (sc.rel === runRel ? " running" : "");
            b.style.setProperty("--i", Math.min(idx++, 40)); b.dataset.rel = sc.rel; b.title = "res://" + sc.rel;
            b.innerHTML = "<span class='gl'>▶</span><b></b><small></small>";
            hl(b.querySelector("b"), nameOf(sc), ts);
            b.querySelector("small").textContent = subOf(sc) ? subOf(sc).replace(/\//g, "  ›  ").toUpperCase() : ".tscn";
            b.onclick = (ev) => launch(sc, b, ev);
            cards.appendChild(b);
          });
          body.appendChild(cards);
        });
      }
      g.appendChild(body); grid.appendChild(g);
    });
  }
  $("f6-clear").onclick = () => { S.filter = ""; $("f6-filter").value = ""; renderGrid(); $("f6-filter").focus(); };
  $("f6-fold").onclick = () => {
    if (S.folded.size) S.folded.clear(); else cats().forEach((c) => S.folded.add(c[0]));
    renderGrid();
  };
  $("f6-filter").addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.filter) { e.stopPropagation(); $("f6-clear").click(); }
    if (e.key === "Enter" && visible().length === 1) { const c = $("f6-grid").querySelector(".f6-card"); if (c) c.click(); }
  });
  document.addEventListener("keydown", (e) => {
    const t = ((document.activeElement || {}).tagName || "");
    if (S.open && e.key === "/" && !/INPUT|TEXTAREA/.test(t)) { e.preventDefault(); $("f6-filter").focus(); }
  });
  $("f6-filter").addEventListener("input", (e) => { S.filter = e.target.value; renderGrid(); });
  $("f6-refresh").onclick = () => { loadScenes(); toast("SCAN DU PROJET…"); };
  // inclinaison 3D des cartes (souris uniquement)
  $("f6-grid").addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const c = e.target.closest(".f6-card"); if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty("--ry", (((e.clientX - r.left) / r.width - 0.5) * 12).toFixed(1) + "deg");
    c.style.setProperty("--rx", ((0.5 - (e.clientY - r.top) / r.height) * 10).toFixed(1) + "deg");
  });
  $("f6-grid").addEventListener("pointerout", (e) => { const c = e.target.closest(".f6-card"); if (c && !c.contains(e.relatedTarget)) { c.style.setProperty("--rx", "0deg"); c.style.setProperty("--ry", "0deg"); } });

  // ---------------------------------------------------------------- lancement d'une scène (équivalent F6)
  async function launch(sc, card, ev) {
    if (S.launching || sceneBusy) return;
    S.launching = true; sceneBusy = true;
    card.classList.add("launching");
    const r0 = card.getBoundingClientRect(), ign = document.createElement("span"); ign.className = "ign";
    ign.style.left = (ev && ev.clientX ? ev.clientX - r0.left : r0.width / 2) + "px"; ign.style.top = (ev && ev.clientY ? ev.clientY - r0.top : r0.height / 2) + "px";
    card.appendChild(ign); setTimeout(() => ign.remove(), 800);
    beep(520, 50, "square", 0.05); beep(1040, 70, "square", 0.05, 70);
    toast("LANCEMENT  ·  " + nameOf(sc).toUpperCase());
    try {
      const n = await api("/api/narration/godot");
      line("sys", "// scène F6", (sc.dir ? sc.dir + "/" : "") + sc.name);
      let run;
      await sayRef(n.run, { onStart: () => {                                    // la scène démarre à l'instant où E.N.O.S. l'annonce
        run = api("/api/godot/run", { method: "POST", body: JSON.stringify({ rel: sc.rel, project: isRemote() ? undefined : current }) })
          .catch((e) => ({ ok: false, message: e.message }))
          .then((r) => {
            card.classList.remove("launching");
            if (r.ok) { remember(sc); toast("EN COURS  ·  " + nameOf(sc).toUpperCase()); sfx.ok(); pollNow(); setTimeout(pollNow, 1500); }
            else toast(r.message || "Échec du lancement", true);
            return r;
          });
      } });
      const r = await run;
      if (!r.ok) await sayRef(r.code === "no_godot" ? n.notfound : n.fail, { kind: "err" });
    } catch (e) { card.classList.remove("launching"); toast(e.message, true); }
    finally { S.launching = false; sceneBusy = false; card.classList.remove("launching"); }
  }
  function remember(sc) {
    S.recents = [sc.rel, ...S.recents.filter((r) => r !== sc.rel)].slice(0, 8);
    try { localStorage.setItem("nasko_f6_recents", JSON.stringify(S.recents)); } catch (e) {}
    renderChips();
  }

  // ---------------------------------------------------------------- état du PC, visu en direct
  async function pollNow() {
    if (!S.open) return;
    try {
      const st = await api("/api/f6/state"); S.fails = 0; S.st = st; S.offset = st.now * 1000 - Date.now(); renderState(st);
    } catch (e) {
      S.fails++; setChip("chip-pc", "bad", "PC INJOIGNABLE");
      if (S.fails >= 2) { disconnect(); $("f6-nosig-msg").textContent = "Le PC ne répond plus (éteint, en veille ou hors réseau)."; }
    }
  }
  const setChip = (id, cls, text) => { const c = $(id); c.className = "chip " + cls; c.textContent = text; };
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
  const REASONS = { aucune_fenetre: "La fenêtre du jeu n'est pas encore affichée…", reduite: "La fenêtre du jeu est réduite sur le PC.", noir: "Image noire : la scène charge encore…", erreur: "Capture momentanément impossible." };

  function renderState(st) {
    $("f6-project").textContent = (st.project || "AUCUN PROJET").toUpperCase() + "  ·  " + (st.host || "").toUpperCase();
    setChip("chip-pc", "ok pulse", "PC EN LIGNE");
    setChip("chip-godot", st.godot ? "ok" : "bad", st.godot ? "GODOT PRÊT" : "GODOT INTROUVABLE");
    const nv = Array.isArray(st.viewers) ? st.viewers.length : st.viewers;
    setChip("chip-view", nv ? "warn" : "", nv ? "◉ " + nv + (nv > 1 ? " SPECTATEURS" : " SPECTATEUR") : "VISU LIBRE");
    if (Array.isArray(st.viewers)) $("chip-view").title = st.viewers.map((v) => v.name + " (" + v.ip + ")").join("\n");
    const run = st.running && st.running[0], mode = st.screen.mode, stage = $("f6-stage");
    $("f6-run-name").textContent = run ? run.name.replace(/\.tscn$/i, "") + (run.by && run.by !== "PC" ? "  ·  par " + run.by : "") : "Aucune scène en cours";
    $("f6-run-time").textContent = run ? fmtTime((Date.now() + S.offset) / 1000 - run.started) : "";
    $("f6-stop").disabled = !run;
    document.querySelectorAll("#f6-grid .f6-card").forEach((c) => c.classList.toggle("running", !!run && c.dataset.rel === run.rel));
    $("f6-share").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.m === mode));
    const want = (!!run || mode === "full") && mode !== "off" && st.screen.available;
    stage.classList.toggle("idle", !want);
    if (want && !S.streaming && !document.hidden) connect();
    if (!want && S.streaming) disconnect();
    $("t-proj").textContent = st.project || "—"; $("t-scenes").textContent = S.scenes.length || "—";
    $("t-run").textContent = run ? run.name.replace(/\.tscn$/i, "") : "—"; $("t-run").classList.toggle("hot", !!run);
    $("t-time").textContent = run ? fmtTime((Date.now() + S.offset) / 1000 - run.started) : "—";
    $("t-view").textContent = nv || 0; $("t-mode").textContent = mode === "full" ? "ÉCRAN" : mode === "off" ? "COUPÉE" : "FENÊTRE";
    const sig = st.screen.signal;
    let msg = "Lancez une scène pour la voir ici";
    if (!st.screen.available) msg = "Visu indisponible sur ce PC";
    else if (mode === "off") msg = "Partage d'écran désactivé sur le PC";
    else if (want && sig) msg = REASONS[sig] || "En attente du signal…";
    else if (want) msg = "Connexion au flux…";
    $("f6-nosig-msg").textContent = msg;
    $("f6-live").classList.toggle("sig", !sig);
    stage.classList.toggle("live", want && S.imgOk && !sig);
    const img = $("f6-live");
    $("f6-fps").textContent = (mode === "full" ? "ÉCRAN COMPLET" : "FENÊTRE DU JEU") + "  ·  " + S.q.toUpperCase();
    $("f6-res").textContent = S.imgOk && img.naturalWidth ? img.naturalWidth + "×" + img.naturalHeight : "";
    if (!run) $("f6-nosig-title").textContent = mode === "off" ? "PARTAGE COUPÉ" : "AUCUN SIGNAL"; else $("f6-nosig-title").textContent = "ACQUISITION…";
  }
  function connect() {
    const img = $("f6-live"); S.imgOk = false; S.streaming = true;
    img.onload = () => { S.imgOk = true; if (S.st) renderState(S.st); };
    img.onerror = () => { S.streaming = false; S.imgOk = false; clearTimeout(S.retry); S.retry = setTimeout(() => { if (S.open && !document.hidden) pollNow(); }, 2500); };
    window.naskoSec.ticketUrl("/api/screen/stream?q=" + S.q + "&t=" + Date.now()).then((u) => { img.src = u; }).catch(() => img.onerror && img.onerror());
  }
  function disconnect() {
    clearTimeout(S.retry); const img = $("f6-live");
    if (S.streaming || img.getAttribute("src")) { img.onload = img.onerror = null; img.removeAttribute("src"); }
    S.streaming = false; S.imgOk = false; $("f6-stage").classList.remove("live");
  }
  $("f6-q").querySelectorAll("button").forEach((b) => b.onclick = () => {
    S.q = b.dataset.q; try { localStorage.setItem("nasko_f6_q", S.q); } catch (e) {}
    $("f6-q").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    if (S.streaming) { disconnect(); connect(); }
    if (S.st) renderState(S.st);
  });
  $("f6-stop").onclick = async () => {
    try { const r = await api("/api/godot/stop", { method: "POST" }); toast(r.stopped ? "SCÈNE ARRÊTÉE" : "AUCUNE SCÈNE EN COURS"); sfx.err(); } catch (e) { toast(e.message, true); }
    pollNow(); setTimeout(pollNow, 800);
  };
  $("f6-share").querySelectorAll("button").forEach((b) => b.onclick = async () => {
    try { await api("/api/screen/mode", { method: "POST", body: JSON.stringify({ mode: b.dataset.m }) }); toast("PARTAGE D'ÉCRAN : " + b.textContent); } catch (e) { toast(e.message, true); }
    disconnect(); pollNow();
  });
  $("f6-full").onclick = () => {
    const st = $("f6-stage");
    if (document.fullscreenElement) document.exitFullscreen(); else if (st.requestFullscreen) st.requestFullscreen().catch(() => toast("Plein écran indisponible", true));
  };
  // ---------------------------------------------------------------- ZONE TESTS F6 (bandeau toujours visible sous l'en-tête du chat)
  const FZ = $("f6-zone");
  let zoneKey = "";
  function zoneRender() {
    const n = S.scenes.length, run = S.st && S.st.running && S.st.running[0];
    FZ.classList.toggle("run", !!run); FZ.classList.toggle("off", !!S.zoneOff);
    let sub;
    if (S.zoneOff) sub = "PC injoignable";
    else if (run) sub = "▶ EN COURS : " + run.name.replace(/\.tscn$/i, "") + "  ·  " + fmtTime((Date.now() + (S.offset || 0)) / 1000 - run.started);
    else if (S.err) sub = "⚠ " + S.err;
    else if (n) sub = n + " scènes  ·  " + cats().length + " catégories  ·  prêt";
    else sub = S.loaded ? "Aucune scène dans ce projet" : "Analyse du projet…";
    $("fz-sub").textContent = sub;
    const key = cats().map((c) => c.join(":")).join("|");
    if (key !== zoneKey) {
      zoneKey = key; const box = $("fz-cats"); box.textContent = "";
      cats().forEach(([c, count]) => {
        const b = document.createElement("button"); b.type = "button"; b.style.setProperty("--c", hueOf(c));
        b.textContent = catLabel(c); const i = document.createElement("i"); i.textContent = count; b.appendChild(i);
        b.onclick = (ev) => { S.chip = "cat:" + c; S.filter = ""; $("f6-filter").value = ""; renderChips(); renderGrid(); openF6(ev); };
        box.appendChild(b);
      });
    }
  }
  $("f6-zone-main").onclick = (e) => openF6(e);
  async function zonePoll() {
    if (S.open || document.hidden) return;
    try { const st = await api("/api/f6/state"); S.st = st; S.offset = st.now * 1000 - Date.now(); S.zoneOff = false; }
    catch (e) { S.zoneOff = true; }
    zoneRender();
  }
  loadScenes().then(zoneRender); setTimeout(() => loadScenes().then(zoneRender), 3000);
  zonePoll(); setInterval(zonePoll, 5000); setInterval(() => { if (!S.open && S.st && S.st.running && S.st.running[0]) zoneRender(); }, 1000);
})();
