"use strict";
// CONSEILLER BRILLANTS : colle (ou choisis) une CAPTURE D'ÉCRAN de ta partie contre un bot -> E.N.O.S. reconnaît chaque pièce, reconstruit la position,
// puis ETO cherche le meilleur coup ET tous les sacrifices qui seraient jugés « Brillants » (!!). Tout est local : aucun PC, aucun réseau (l'IA Groq n'est
// qu'un second avis facultatif pour lire une capture difficile).
// Réservé aux parties contre des bots / à l'entraînement : contre un humain, utiliser un moteur pendant la partie est de la triche.
(() => {
  const E = window.ENOS, esc = E.esc;
  const FILES = "abcdefgh";
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const PIECES = "KQRBNPkqrbnp";
  const PIECE_IMG = (p) => `img/chess/${p === p.toUpperCase() ? "w" : "b"}${p.toLowerCase()}.png`;
  const MS = { fast: [600, 1200], normal: [1000, 2200], deep: [1800, 4500] };

  E.suite.register({
    id: "advisor", group: "chess", title: "Conseiller brillants", sub: "Capture d'écran → coups !!",
    icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/><circle cx="16" cy="16" r="2"/>',
    build(el, A) {
      const B = E.board, $ = (s) => el.querySelector(s);
      const G = { read: null, map: parseFen(START).map, turn: "w", flip: false, mode: "edit", sel: "", hint: null, last: null, busy: false, hist: [], res: null, pick: -1, shot: null, rect: null, ai: false, castling: null };
      el.innerHTML = `
        <div class="card" id="ad-in">
          <h3>1 · La position</h3>
          <p class="muted" style="font-size:14px;margin-bottom:10px">Fais une capture d'écran de ta partie (Chess.com, Lichess…) puis colle-la ici : les pièces sont reconnues toutes seules.</p>
          <div class="row"><button class="btn pri" id="ad-pick">CHOISIR UNE CAPTURE</button><button class="btn" id="ad-paste">COLLER</button></div>
          <div id="ad-shot" hidden>
            <canvas id="ad-prev" aria-label="Capture avec l'échiquier repéré"></canvas>
            <div class="muted" id="ad-found" style="font-size:13px;margin:4px 0"></div>
            <label class="chip2" style="display:inline-flex;gap:8px;margin:6px 0"><input type="checkbox" id="ad-auto" ${E.settings.get("advisor.auto", true) ? "checked" : ""}> Chercher les brillants dès que la capture est lue</label>
            <div class="row" id="ad-mem" hidden><button class="btn" id="ad-learn">✓ C'EST BON : MÉMORISER CE JEU DE PIÈCES</button></div>
            <div class="muted" id="ad-memn" style="font-size:12px;margin:2px 0 6px"></div>
            <details id="ad-adj"><summary class="muted" style="font-size:13px;padding:6px 0">Mal cadré ? Ajuster</summary>
              <label class="fld">Gauche<input type="range" id="ad-x" min="0" max="100" value="0"></label>
              <label class="fld">Haut<input type="range" id="ad-y" min="0" max="100" value="0"></label>
              <label class="fld">Taille<input type="range" id="ad-s" min="1" max="100" value="50"></label>
              <div class="row"><button class="btn" id="ad-ai">LIRE AVEC L'IA (GROQ)</button></div>
            </details>
          </div>
        </div>
        <div class="card">
          <div class="seg" id="ad-seg" data-p="enos"><button data-m="edit" class="on">PLACER</button><button data-m="play">JOUER</button><i class="seg-ind"></i></div>
          <div class="ch-top" style="margin-top:8px"><span id="ad-status" class="muted">Pose les pièces ou colle une capture</span></div>
          <div id="ad-wrap" style="position:relative"><div id="ad-board"></div><svg id="ad-arrows" viewBox="0 0 8 8" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></svg></div>
          <div class="row" style="margin-top:8px"><button class="btn" id="ad-turn">TRAIT : BLANCS</button><button class="btn" id="ad-flip">RETOURNER</button><button class="btn" id="ad-undo">ANNULER</button></div>
          <div class="row" style="margin-top:8px"><button class="btn" id="ad-start">DÉPART</button><button class="btn" id="ad-clear">VIDER</button><button class="btn" id="ad-fen">FEN…</button></div>
        </div>
        <div class="card">
          <h3>2 · Le conseil d'ETO</h3>
          <div class="seg" id="ad-lvl" data-p="eto"><button data-l="fast">RAPIDE</button><button data-l="normal" class="on">NORMAL</button><button data-l="deep">PROFOND</button><i class="seg-ind"></i></div>
          <div class="row" style="margin-top:10px"><button class="btn pri" id="ad-go">TROUVER LES COUPS BRILLANTS</button></div>
          <div class="rv-prog" id="ad-prog" hidden><i></i></div>
          <div id="ad-out"></div>
          <p class="muted" style="font-size:12px;margin-top:10px">À utiliser contre des bots ou pour t'entraîner. Contre un humain, c'est de la triche.</p>
        </div>`;

      const fen = () => E.boardScan.fenOf(G.map, G.turn, G.castling != null ? { castling: G.castling } : {});
      function parseFen(f) { const p = B.parse(f); return { map: p.m, turn: p.turn }; }
      const status = (t, bad) => { const s = $("#ad-status"); s.textContent = t; s.style.color = bad ? "#ff7a8a" : ""; };
      const validate = () => E.boardScan.validate(fen());

      function paint() {
        const f = fen(), bad = validate();
        let targets = [];
        if (G.mode === "play" && G.sel && !bad) { try { targets = new Chess(f).moves({ square: G.sel, verbose: true }).map((m) => m.to); } catch (e) { /* position invalide */ } }
        B.render($("#ad-board"), G.map, { flip: G.flip, last: G.last, hint: G.hint, sel: G.sel, targets, onTap });
        $("#ad-turn").textContent = "TRAIT : " + (G.turn === "w" ? "BLANCS" : "NOIRS");
        if (!G.busy) status(bad || (G.mode === "play" ? "Joue les coups de la partie sur le plateau" : "Touche une case pour changer sa pièce"), !!bad);
        arrows();
      }

      // ---- flèches (coup sélectionné)
      function arrows() {
        const svg = $("#ad-arrows"); svg.innerHTML = "";
        const c = G.res && G.pick >= 0 ? G.res.items[G.pick] : null;
        if (!c) return;
        const xy = (sq) => { const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1; return [(G.flip ? 7 - f : f) + 0.5, (G.flip ? r : 7 - r) + 0.5]; };
        const [x1, y1] = xy(c.uci.slice(0, 2)), [x2, y2] = xy(c.uci.slice(2, 4)), dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
        const col = c.brilliant ? "#1acfd6" : c.sac ? "#f5a524" : "#7bd64d";
        const hx = x2 - ux * 0.35, hy = y2 - uy * 0.35;
        svg.innerHTML = `<line x1="${x1}" y1="${y1}" x2="${hx}" y2="${hy}" stroke="${col}" stroke-width="0.17" stroke-linecap="round" opacity=".85"/>
          <polygon points="${x2},${y2} ${hx - uy * 0.2},${hy + ux * 0.2} ${hx + uy * 0.2},${hy - ux * 0.2}" fill="${col}" opacity=".9"/>`;
      }

      // ---- interaction plateau
      function snapshot() { G.hist.push({ map: { ...G.map }, turn: G.turn, last: G.last }); if (G.hist.length > 60) G.hist.shift(); }
      function onTap(sq) {
        if (G.busy) return;
        if (G.mode === "edit") return palette(sq);
        const f = fen();
        if (validate()) return;
        const ch = new Chess(f);
        if (G.sel && ch.moves({ square: G.sel, verbose: true }).some((m) => m.to === sq)) return playMove(G.sel, sq);
        const p = G.map[sq];
        G.sel = p && (p === p.toUpperCase()) === (G.turn === "w") ? sq : "";
        paint();
      }
      async function playMove(from, to) {
        const ch = new Chess(fen()), mv = ch.moves({ square: from, verbose: true }).find((m) => m.to === to);
        let promo;
        if (mv && mv.promotion) promo = await new Promise((res) => E.ui.sheet({ title: "Promotion", options: [["q", "Dame"], ["r", "Tour"], ["b", "Fou"], ["n", "Cavalier"]].map(([c, n]) => ({ label: n, fn: () => res(c) })), onClose: () => res("q") }));
        snapshot();
        const m = ch.move({ from, to, promotion: promo });
        if (!m) return;
        G.map = E.brain.mapOf(ch); G.turn = ch.turn(); G.last = [from, to]; G.sel = ""; G.hint = null; G.res = null; G.pick = -1; G.castling = null; G.read = null; $("#ad-mem").hidden = true;
        $("#ad-out").innerHTML = "";
        E.chessSound && E.chessSound.forSan(m.san);
        paint();
      }
      function palette(sq) {
        const cur = G.map[sq] || "";
        const s = E.ui.sheet({ title: "Case " + sq, html: `<div class="ad-pal">${[...PIECES].map((p) => `<button data-p="${p}" class="${p === cur ? "on" : ""}" aria-label="${p}"><img src="${PIECE_IMG(p)}" alt=""></button>`).join("")}<button data-p="" class="${cur ? "" : "on"}" aria-label="Vide">✕</button></div>`, options: [{ label: "FERMER" }] });
        s.querySelectorAll(".ad-pal button").forEach((b) => (b.onclick = () => {
          snapshot();
          if (b.dataset.p) G.map[sq] = b.dataset.p; else delete G.map[sq];
          if (G.read && b.dataset.p) { const q = G.read.squares.find((z) => z.sq === sq); if (q && q.piece) { E.boardScan.learn({ squares: [q] }, { [sq]: b.dataset.p }); memNote(); } }      // une correction est sûre : on la retient aussitôt
          G.res = null; G.pick = -1; G.hint = null; G.castling = null; $("#ad-out").innerHTML = "";
          E.ui.closeSheet(); E.vibrate(6); paint();
        }));
      }

      $("#ad-seg").querySelectorAll("button").forEach((b) => (b.onclick = () => {
        G.mode = b.dataset.m; G.sel = "";
        $("#ad-seg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); $("#ad-seg").dataset.p = G.mode === "edit" ? "enos" : "eto"; paint();
      }));
      $("#ad-turn").onclick = () => { G.turn = G.turn === "w" ? "b" : "w"; G.res = null; G.pick = -1; $("#ad-out").innerHTML = ""; paint(); };
      $("#ad-flip").onclick = () => { G.flip = !G.flip; paint(); };
      $("#ad-undo").onclick = () => { const h = G.hist.pop(); if (!h) return; G.map = h.map; G.turn = h.turn; G.last = h.last; G.sel = ""; G.res = null; G.pick = -1; $("#ad-out").innerHTML = ""; paint(); };
      $("#ad-start").onclick = () => { snapshot(); const p = parseFen(START); G.map = p.map; G.turn = "w"; G.last = null; G.res = null; G.pick = -1; G.castling = null; $("#ad-out").innerHTML = ""; paint(); };
      $("#ad-clear").onclick = () => { snapshot(); G.map = {}; G.last = null; G.res = null; G.pick = -1; $("#ad-out").innerHTML = ""; paint(); };
      $("#ad-fen").onclick = () => {
        const s = E.ui.sheet({ title: "Position (FEN)", html: `<textarea id="ad-fent" class="ta" rows="3" spellcheck="false" aria-label="FEN">${esc(fen())}</textarea>`, options: [{ label: "APPLIQUER", fn: () => setFen(s.querySelector("#ad-fent").value.trim()) }, { label: "COPIER", fn: () => A.copy(s.querySelector("#ad-fent").value) }, { label: "FERMER" }] });
      };
      function setFen(f) {
        try { new Chess(f); } catch (e) { return A.toast("FEN invalide.", "warn"); }
        snapshot(); const p = parseFen(f); G.map = p.map; G.turn = p.turn; G.castling = (f.split(" ")[2] || "-").replace("-", ""); G.last = null; G.res = null; G.pick = -1; G.read = null; $("#ad-mem").hidden = true; $("#ad-out").innerHTML = ""; paint();
      }

      // ---- capture d'écran
      async function loadShot(src) {
        status("Lecture de la capture…");
        try {
          await loadTemplates();
          const canvas = await E.boardScan.toCanvas(src);
          G.shot = canvas;
          const rect = E.boardScan.detect(canvas);
          $("#ad-shot").hidden = false;
          if (!rect) {
            G.rect = null; drawPrev();
            $("#ad-found").textContent = "Échiquier introuvable. Ajuste le cadre ci-dessous ou lis la capture avec l'IA.";
            $("#ad-adj").open = true; sliders(canvas, null);
            return status("Échiquier introuvable dans cette capture.", true);
          }
          G.rect = rect; sliders(canvas, rect); applyRect(true);
        } catch (e) { status("✕ " + e.message, true); }
      }
      function sliders(c, r) {
        const W = c.width, H = c.height, m = Math.max(W, H);
        const x = $("#ad-x"), y = $("#ad-y"), s = $("#ad-s");
        x.max = W; y.max = H; s.max = Math.round(m / 8); s.min = 8;
        if (r) { x.value = Math.round(r.x); y.value = Math.round(r.y); s.value = Math.round(r.s); }
        else { x.value = 0; y.value = 0; s.value = Math.round(Math.min(W, H) / 8); }
      }
      function manualRect() {
        const base = G.rect || {};
        const light = base.light || [238, 238, 210], dark = base.dark || [118, 150, 86];
        return { x: +$("#ad-x").value, y: +$("#ad-y").value, s: +$("#ad-s").value, light, dark };
      }
      let adjT = 0;
      ["#ad-x", "#ad-y", "#ad-s"].forEach((q) => ($(q).oninput = () => { clearTimeout(adjT); G.rect = manualRect(); drawPrev(); adjT = setTimeout(() => applyRect(false), 250); }));
      function drawPrev() {
        const c = $("#ad-prev"), s = G.shot; if (!s) return;
        const k = Math.min(1, 640 / s.width); c.width = Math.round(s.width * k); c.height = Math.round(s.height * k);
        c.style.width = "100%"; c.style.borderRadius = "10px";
        const x = c.getContext("2d"); x.drawImage(s, 0, 0, c.width, c.height);
        const r = G.rect; if (r) { x.strokeStyle = "#1acfd6"; x.lineWidth = 3; x.strokeRect(r.x * k, r.y * k, r.s * 8 * k, r.s * 8 * k); x.lineWidth = 1; x.globalAlpha = 0.5; for (let i = 1; i < 8; i++) { x.beginPath(); x.moveTo((r.x + i * r.s) * k, r.y * k); x.lineTo((r.x + i * r.s) * k, (r.y + 8 * r.s) * k); x.moveTo(r.x * k, (r.y + i * r.s) * k); x.lineTo((r.x + 8 * r.s) * k, (r.y + i * r.s) * k); x.stroke(); } }
      }
      function applyRect(auto) {
        if (!G.shot || !G.rect) return;
        drawPrev();
        const rd = E.boardScan.read(G.shot, G.rect, {});
        snapshot();
        G.map = rd.map; G.turn = rd.turn; G.flip = rd.flipped; G.last = rd.last.length === 2 ? rd.last : null; G.castling = null; G.res = null; G.pick = -1; G.hint = null; G.sel = "";
        $("#ad-out").innerHTML = "";
        const low = rd.squares.filter((q) => q.pc && q.conf < 0.6).length, n = Object.keys(rd.map).length;
        G.lowSq = rd.squares.filter((q) => q.pc && q.conf < 0.6).map((q) => (rd.flipped ? FILES[7 - q.c] + (q.r + 1) : FILES[q.c] + (8 - q.r)));
        $("#ad-found").textContent = `Échiquier repéré · ${n} pièces lues${low ? ` · ${low} incertaine${low > 1 ? "s" : ""} (touche une case pour corriger)` : ""} · ${rd.flipped ? "Noirs en bas" : "Blancs en bas"}`;
        G.read = rd; $("#ad-mem").hidden = false; memNote();
        G.mode = "edit"; $("#ad-seg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.m === "edit"));
        paint();
        if (auto) {
          E.vibrate(15); status(validate() || `${n} pièces reconnues. Vérifie le plateau, puis lance le conseil.`, !!validate());
          if ($("#ad-auto").checked && !validate() && !low && !G.busy) setTimeout(() => $("#ad-go").click(), 150);                  // capture nette et position valide : le conseil part tout seul
        }
      }
      function memNote() {
        const n = E.boardScan.memorySize();
        $("#ad-memn").innerHTML = n ? `${n} forme${n > 1 ? "s" : ""} de pièces mémorisée${n > 1 ? "s" : ""} : ton jeu de pièces est reconnu de mieux en mieux. <a href="#" id="ad-forget" style="color:var(--red2)">Oublier</a>` : "Corrige les pièces mal lues, puis touche « C'est bon » : E.N.O.S. apprend ton jeu de pièces et les prochaines captures seront reconnues sans erreur.";
        const f = $("#ad-forget"); if (f) f.onclick = (e) => { e.preventDefault(); E.boardScan.forget(); memNote(); };
      }
      $("#ad-learn").onclick = () => {
        if (!G.read) return;
        if (validate()) return status(validate(), true);
        const n = E.boardScan.learn(G.read, G.map); memNote(); A.toast(n ? n + " forme" + (n > 1 ? "s" : "") + " apprise" + (n > 1 ? "s" : "") + "." : "Déjà connues.", "ok"); E.vibrate(15);
      };
      function loadTemplates() {
        if (window.ENOS_PM) return Promise.resolve();
        return new Promise((res, rej) => { const s = document.createElement("script"); s.src = (E.assetBase || "") + "data/piece_model.js"; s.onload = res; s.onerror = () => rej(new Error("Modèle de reconnaissance introuvable.")); document.head.appendChild(s); });
      }
      $("#ad-auto").onchange = () => E.settings.set("advisor.auto", $("#ad-auto").checked);
      $("#ad-pick").onclick = async () => { const f = (await A.pick({ accept: "image/*" }))[0]; if (f) loadShot(f); };
      $("#ad-paste").onclick = async () => {
        try {
          const items = await navigator.clipboard.read();
          for (const it of items) { const t = it.types.find((x) => x.startsWith("image/")); if (t) return loadShot(await it.getType(t)); }
          A.toast("Aucune image dans le presse-papiers.", "warn");
        } catch (e) { A.toast("Presse-papiers inaccessible : utilise « Choisir une capture ».", "warn", 4500); }
      };
      el.addEventListener("paste", (e) => { const it = [...(e.clipboardData ? e.clipboardData.items : [])].find((x) => x.type.startsWith("image/")); if (it) { e.preventDefault(); loadShot(it.getAsFile()); } });
      document.addEventListener("paste", (e) => { if (!el.offsetParent) return; if (e.target && /input|textarea/i.test(e.target.tagName)) return; const it = [...(e.clipboardData ? e.clipboardData.items : [])].find((x) => x.type.startsWith("image/")); if (it) { e.preventDefault(); loadShot(it.getAsFile()); } });
      el._loadShot = loadShot;                                         // utilisé par le partage Android et les tests

      // lecture par l'IA (second avis) : Groq vision renvoie la FEN
      $("#ad-ai").onclick = async () => {
        if (!G.shot) return;
        if (!E.ai || !E.ai.configured()) return A.toast("Clé Groq absente : Réglages → Clés d'API.", "warn");
        status("L'IA lit la capture…"); $("#ad-ai").disabled = true;
        try {
          const small = document.createElement("canvas"), k = Math.min(1, 1024 / Math.max(G.shot.width, G.shot.height));
          small.width = Math.round(G.shot.width * k); small.height = Math.round(G.shot.height * k); small.getContext("2d").drawImage(G.shot, 0, 0, small.width, small.height);
          const txt = await A.llmVision({ system: "Tu lis des captures d'échiquiers avec une précision absolue.", ask: "Donne UNIQUEMENT la FEN (champ des pièces, trait, roques) de la position affichée sur cet échiquier. Les Blancs sont en haut si la capture montre les coordonnées renversées. Réponds par une seule ligne FEN, sans commentaire.", image: small, maxTokens: 200 });
          const m = txt.match(/([rnbqkpRNBQKP1-8]+\/){7}[rnbqkpRNBQKP1-8]+(\s+[wb])?(\s+[KQkq-]+)?/);
          if (!m) throw new Error("L'IA n'a pas donné de FEN exploitable.");
          const f = m[0].trim().split(/\s+/); setFen(`${f[0]} ${f[1] || "w"} ${f[2] || "-"} - 0 1`);
          status("Position lue par l'IA : vérifie-la attentivement.");
        } catch (e) { status("✕ " + e.message, true); } finally { $("#ad-ai").disabled = false; }
      };

      // ---- le conseil
      $("#ad-lvl").querySelectorAll("button").forEach((b) => (b.onclick = () => { $("#ad-lvl").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); }));
      const level = () => ($("#ad-lvl button.on") || {}).dataset.l || "normal";
      $("#ad-go").onclick = async () => {
        if (G.busy) return;
        const bad = validate(); if (bad) return status(bad, true);
        const f = fen(); if (new Chess(f).game_over()) return status("La partie est terminée dans cette position.", true);
        G.busy = true; G.sel = ""; G.hint = null; G.pick = -1; $("#ad-go").disabled = true; $("#ad-out").innerHTML = "";
        const prog = $("#ad-prog"), bar = prog.firstElementChild; prog.hidden = false; bar.style.width = "8%";
        status("ETO cherche les sacrifices…");
        const t = setInterval(() => { const w = parseFloat(bar.style.width) || 8; bar.style.width = Math.min(92, w + 3) + "%"; }, 400);
        try {
          const [top, sac] = MS[level()];
          const h = await E.brain.hunt(f, { multipv: 3, topMs: top, sacMs: sac, maxSac: 8, tolerance: 40 });
          const items = [];
          if (h.best) items.push({ uci: h.best.uci, san: h.best.san, score: h.best.score, mate: h.best.mate, line: h.best.line, best: true, loss: 0, brilliant: false, sac: E.brain.isSacrifice(f, h.best.uci) });
          h.sacrifices.filter((s) => s.brilliant || s.loss <= 500).forEach((s) => { if (!items.some((i) => i.uci === s.uci)) items.push({ uci: s.uci, san: s.san, score: s.score, mate: s.mate, line: s.line, loss: s.loss, brilliant: s.brilliant, sac: true, piece: s.piece, deficit: s.deficit }); else { const i = items.find((x) => x.uci === s.uci); i.sac = true; i.brilliant = s.brilliant; } });
          h.lines.slice(1).forEach((l) => { if (!items.some((i) => i.uci === l.uci)) items.push({ uci: l.uci, san: l.san, score: l.score, mate: l.mate, line: E.brain.sanLine(f, l.pv, 6), loss: Math.max(0, h.best.score - l.score), brilliant: false, sac: false }); });
          // le meilleur coup est un sacrifice jugé brillant ? (les brillants d'abord)
          items.forEach((i) => { if (i.best && i.sac) i.brilliant = h.sacrifices.some((s) => s.uci === i.uci && s.brilliant) || i.brilliant; });
          items.sort((a, b) => (b.brilliant - a.brilliant) || (b.best - a.best) || (b.score - a.score));
          G.res = { items, fen: f };
          G.pick = 0; renderOut(); bar.style.width = "100%";
          status(items[0] && items[0].brilliant ? "✦ Un coup brillant existe !" : "Analyse terminée");
          E.vibrate(items[0] && items[0].brilliant ? 30 : 12);
        } catch (e) { status("✕ " + e.message, true); }
        clearInterval(t); setTimeout(() => (prog.hidden = true), 400); G.busy = false; $("#ad-go").disabled = false; paint();
      };

      function renderOut() {
        const r = G.res; if (!r) return;
        const evs = (i) => (i.mate != null ? (i.mate > 0 ? "mat en " + i.mate : "mat subi") : E.brain.fmt(i.score));
        const nBr = r.items.filter((i) => i.brilliant).length;
        $("#ad-out").innerHTML = `<p class="lrn-text" style="margin:12px 0 8px">${nBr ? `<b style="color:#1acfd6">✦ ${nBr} coup${nBr > 1 ? "s" : ""} brillant${nBr > 1 ? "s" : ""} possible${nBr > 1 ? "s" : ""}</b> — ils gardent l'avantage tout en sacrifiant du matériel (le type de coup que Chess.com marque « !! »).` : "Aucun sacrifice brillant ici : le coup recommandé est le meilleur."}</p>
          <div class="list" id="ad-list">${r.items.map((i, k) => `<div class="it ad-it${k === G.pick ? " on" : ""}" data-i="${k}"><span class="n">${esc(i.san)}${i.brilliant ? ' <b class="ad-bad br">!! BRILLANT</b>' : i.sac ? ' <b class="ad-bad sa">SACRIFICE</b>' : ""}${i.best && !i.brilliant ? ' <b class="ad-bad bs">MEILLEUR</b>' : ""}<small>${evs(i)}${i.loss > 8 ? " · −" + (i.loss / 100).toFixed(1).replace(".", ",") + " vs le meilleur" : ""}${i.piece ? " · sacrifie " + i.piece : ""}</small></span><span class="tag">VOIR</span></div>`).join("")}</div>
          <div id="ad-detail"></div>`;
        $("#ad-list").onclick = (e) => { const it = e.target.closest(".ad-it"); if (!it) return; G.pick = +it.dataset.i; renderOut(); arrows(); };
        const c = r.items[G.pick];
        if (c) {
          $("#ad-detail").innerHTML = `<div class="lrn-say"><b>${esc(c.san)}</b> — ligne : ${esc((c.line || []).join(" "))}</div>
            <div class="row" style="margin-top:8px"><button class="btn pri" id="ad-play">JOUER CE COUP</button><button class="btn" id="ad-why">POURQUOI ?</button></div><div class="lrn-say" id="ad-expl" hidden></div>`;
          $("#ad-play").onclick = () => { G.mode = "play"; $("#ad-seg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.m === "play")); playMove(c.uci.slice(0, 2), c.uci.slice(2, 4)); };
          $("#ad-why").onclick = () => explain(c);
        }
        arrows();
      }
      async function explain(c) {
        const box = $("#ad-expl"); box.hidden = false;
        if (!E.ai || !E.ai.configured()) { box.textContent = c.brilliant ? `${c.san} sacrifie ${c.piece || "du matériel"} mais l'évaluation reste favorable (${E.brain.fmt(c.score)}) : la compensation tactique est plus forte que la pièce donnée.` : `${c.san} est jugé ${c.best ? "le meilleur coup" : "jouable"} par le moteur (${E.brain.fmt(c.score)}).`; return; }
        box.textContent = "…";
        const persona = E.settings.get("persona", "enos") === "eto" ? "eto" : "enos";
        const q = `Position (FEN) : ${G.res.fen}. Le moteur recommande ${c.san}${c.brilliant ? " (un sacrifice brillant)" : ""}. Ligne : ${(c.line || []).join(" ")}. Évaluation : ${E.brain.fmt(c.score)} pour le camp qui joue. Explique en 2 phrases courtes pourquoi ce coup est fort, avec l'idée tactique.`;
        try { box.textContent = await E.ai.chat(persona, q, () => {}, { oneShot: true, system: E.ai.PERSONAS[persona].system(E.ai.name()) + " Réponds en 2 phrases, sans liste." }); box.onclick = () => E.ai.speak(persona, box.textContent); }
        catch (e) { box.textContent = "Explication indisponible : " + e.message; }
      }

      el._api = { G, setFen, paint };
      paint();
    },
  });
})();
