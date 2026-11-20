"use strict";
// POKER 3D (Texas Hold'em No Limit) : table ovale (feutre cramoisi, boudin obsidienne, liseré d'or), cartes et jetons en 3D,
// bouton de donneur, mises devant chaque siège, pot au centre. Tes deux cartes en bas, barre d'actions (coucher, parole/suivre, relancer, tapis).
// Moteur et IA : js/games/poker_rules.js. Local : rideau « passe le téléphone » entre joueurs humains.
(() => {
  const E = window.ENOS, G3 = E.g3d, PK = E.poker, esc = E.esc;
  if (!E.jeux || !G3 || !PK) return;
  const RULES = `<p>Chaque joueur reçoit <b>2 cartes</b>. Cinq cartes communes arrivent au centre : 3 (flop), puis 1 (turn), puis 1 (river).</p>
    <p>À chaque tour d'enchères : <b>parole</b> (si personne n'a misé), <b>suivre</b>, <b>relancer</b>, <b>tapis</b> ou <b>se coucher</b>.</p>
    <p>À l'abattage, la meilleure combinaison de 5 cartes gagne : quinte flush, carré, full, couleur, quinte, brelan, double paire, paire, hauteur.</p>
    <p>Les blindes doublent toutes les 10 mains. Le dernier joueur avec des jetons gagne.</p>`;
  const RED = "#d3163d", INK = "#15161c", RANK = { 11: "V", 12: "D", 13: "R", 14: "A" };
  const W = 256, H = 356;
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };

  // ------------------------------------------------------------------ couleurs (tracés, indépendants des polices)
  function heart(g, f) { g.moveTo(0, 0.42 * f); g.bezierCurveTo(-0.15, 0.28 * f, -0.5, 0.08 * f, -0.5, -0.16 * f); g.bezierCurveTo(-0.5, -0.38 * f, -0.32, -0.48 * f, -0.2, -0.48 * f); g.bezierCurveTo(-0.08, -0.48 * f, 0, -0.4 * f, 0, -0.3 * f);
    g.bezierCurveTo(0, -0.4 * f, 0.08, -0.48 * f, 0.2, -0.48 * f); g.bezierCurveTo(0.32, -0.48 * f, 0.5, -0.38 * f, 0.5, -0.16 * f); g.bezierCurveTo(0.5, 0.08 * f, 0.15, 0.28 * f, 0, 0.42 * f); g.closePath(); }
  const stem = (g) => { g.moveTo(-0.04, 0.12); g.quadraticCurveTo(-0.06, 0.4, -0.22, 0.5); g.lineTo(0.22, 0.5); g.quadraticCurveTo(0.06, 0.4, 0.04, 0.12); g.closePath(); };
  function suitPath(g, k, s, col) {
    g.save(); g.scale(s, s); g.fillStyle = col; g.beginPath();
    if (k === 1) heart(g, 1);
    else if (k === 2) { g.moveTo(0, -0.5); g.quadraticCurveTo(0.12, -0.2, 0.37, 0); g.quadraticCurveTo(0.12, 0.2, 0, 0.5); g.quadraticCurveTo(-0.12, 0.2, -0.37, 0); g.quadraticCurveTo(-0.12, -0.2, 0, -0.5); g.closePath(); }
    else if (k === 0) { g.translate(0, -0.06); heart(g, -1); g.translate(0, 0.06); stem(g); }
    else { for (const [x, y] of [[0, -0.24], [-0.24, 0.05], [0.24, 0.05]]) { g.moveTo(x + 0.21, y); g.arc(x, y, 0.21, 0, Math.PI * 2); } g.moveTo(0.1, 0); g.arc(0, 0, 0.1, 0, Math.PI * 2); stem(g); }
    g.fill(); g.restore();
  }
  const suitCol = (su) => (su === 1 || su === 2 ? RED : INK);
  function face(c) {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    const r = PK.rank(c), su = PK.suit(c), col = suitCol(su), lab = RANK[r] || String(r);
    rr(g, 3, 3, W - 6, H - 6, 22); const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#fcf9f3"); bg.addColorStop(1, "#e9e2d2"); g.fillStyle = bg; g.fill();
    g.lineWidth = 3; g.strokeStyle = "rgba(176,132,48,.9)"; g.stroke();
    const corner = () => { g.fillStyle = col; g.font = `800 ${lab.length > 1 ? 50 : 60}px Inter, Arial`; g.textAlign = "center"; g.textBaseline = "alphabetic"; g.fillText(lab, 40, 70); g.save(); g.translate(40, 100); suitPath(g, su, 36, col); g.restore(); };
    corner(); g.save(); g.translate(W, H); g.rotate(Math.PI); corner(); g.restore();
    g.save(); g.translate(W / 2, H / 2);
    if (r >= 11 && r <= 13) {
      rr(g, -62, -110, 124, 220, 14); const p = g.createLinearGradient(0, -110, 0, 110); p.addColorStop(0, "#1c1d25"); p.addColorStop(1, "#0a0b0f"); g.fillStyle = p; g.fill(); g.lineWidth = 3; g.strokeStyle = "#e8b54a"; g.stroke();
      rr(g, -54, -102, 108, 204, 10); g.lineWidth = 1; g.strokeStyle = "rgba(232,181,74,.45)"; g.stroke();
      g.fillStyle = "#e8b54a"; g.font = "700 104px Georgia, 'Times New Roman', serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(lab, 0, -18);
      g.translate(0, 62); suitPath(g, su, 52, su === 1 || su === 2 ? "#ff3d63" : "#e8b54a");
    } else if (r === 14) { g.lineWidth = 3; g.strokeStyle = "rgba(176,132,48,.6)"; g.beginPath(); g.arc(0, 0, 96, 0, Math.PI * 2); g.stroke(); suitPath(g, su, 150, col); }
    else suitPath(g, su, 128, col);
    g.restore(); return cv;
  }
  function back() {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    rr(g, 3, 3, W - 6, H - 6, 22); g.fillStyle = "#0b0c10"; g.fill(); g.lineWidth = 4; g.strokeStyle = "#e8b54a"; g.stroke();
    g.save(); rr(g, 20, 20, W - 40, H - 40, 12); g.clip(); const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#5a0718"); bg.addColorStop(1, "#16020a"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(232,181,74,.18)"; g.lineWidth = 1.5; for (let x = -H; x < W + H; x += 18) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + H, H); g.stroke(); g.beginPath(); g.moveTo(x + H, 0); g.lineTo(x, H); g.stroke(); } g.restore();
    rr(g, 20, 20, W - 40, H - 40, 12); g.lineWidth = 2; g.strokeStyle = "rgba(232,181,74,.7)"; g.stroke();
    g.save(); g.translate(W / 2, H / 2); g.fillStyle = "#0b0c10"; g.beginPath(); g.arc(0, 0, 54, 0, Math.PI * 2); g.fill(); g.lineWidth = 3; g.strokeStyle = "#e8b54a"; g.stroke();
    g.fillStyle = "#e8b54a"; g.beginPath(); g.moveTo(0, -30); g.lineTo(27, 17); g.lineTo(-27, 17); g.closePath(); g.fill(); g.fillStyle = "#0b0c10"; g.beginPath(); g.moveTo(0, -16); g.lineTo(15, 9); g.lineTo(-15, 9); g.closePath(); g.fill(); g.restore();
    return cv;
  }
  const urls = new Map();
  const faceURL = (c) => { if (!urls.has(c)) urls.set(c, face(c).toDataURL("image/png")); return urls.get(c); };

  E.jeux.register({
    id: "poker", title: "Poker", sub: "Texas Hold'em No Limit, de 2 à 6 joueurs", hero: "img/games/poker/room_bg.webp", min: 2, max: 6, rules: RULES,
    icon: '<path d="M12 3c3 4 7 6.5 7 10a4 4 0 0 1-7 2.6A4 4 0 0 1 5 13c0-3.5 4-6 7-10z"/><path d="M12 15.5L10 21h4z"/>',
    options: [{ key: "stack", label: "Jetons de départ", def: 1000, choices: [[500, "500"], [1000, "1 000"], [2500, "2 500"]] },
      { key: "hands", label: "Durée", def: 0, choices: [[0, "Jusqu'au dernier"], [20, "20 mains"], [40, "40 mains"]] }],
    async start(host, setup, api) {
      const P = setup.players, n = P.length, bots = setup.mode === "bots", o = setup.opts || {};
      const st = PK.newGame(n, { stack: +o.stack || 1000, sb: 10, bb: 20, hands: +o.hands || 0, seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0 });
      const RX = 3.25, RZ = 4.7, EL = 64 * Math.PI / 180, TW = (RX + 1.1) * 2, TD = (RZ + 1.1) * 2;
      const S = await G3.stage(host, { fov: 40, exposure: 1.0, fog: 0.01, cam: [0, 14, 7], look: [0, 0, 0],
        fit: (cam, ar) => { const vf = cam.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * ar);
          const d = Math.max((TW / 2) / Math.tan(hf / 2), (TD * Math.sin(EL) * 0.6) / Math.tan(vf / 2)) + 1.2;
          cam.position.set(0, d * Math.sin(EL), d * Math.cos(EL) + 1.4); cam.lookAt(0, 0, 1.4); } });
      const T = S.T, M = S.mats;
      G3.backdrop(S, { y: -1.2, glow: 22 });
      // ---------------------------------------------------------------- table
      const felt = G3.canvasTex(T, 1024, 1024, (g, w, h) => {
        const r = g.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w / 2); r.addColorStop(0, "#760b21"); r.addColorStop(0.75, "#3a0510"); r.addColorStop(1, "#1d0208"); g.fillStyle = r; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 14000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? 0 : 255},0,0,${Math.random() * 0.045})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
        g.strokeStyle = "rgba(232,181,74,.32)"; g.lineWidth = 4; g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.4, h * 0.4, 0, 0, Math.PI * 2); g.stroke();
      });
      const top = new T.Mesh(new T.CylinderGeometry(1, 1, 0.3, 128), [new T.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.35, metalness: 0.4 }), new T.MeshStandardMaterial({ map: felt, roughness: 0.96 }), M.obsidian]);
      top.scale.set(RX + 0.35, 1, RZ + 0.35); top.position.y = -0.15; top.receiveShadow = true; S.add(top);
      const ell = (a, b, y) => { const c = new T.Curve(); c.getPoint = (t, out) => (out || new T.Vector3()).set(Math.cos(t * Math.PI * 2) * a, y, Math.sin(t * Math.PI * 2) * b); return c; };
      const rail = new T.Mesh(new T.TubeGeometry(ell(RX + 0.6, RZ + 0.6, 0.02), 256, 0.36, 20, true), M.obsidian); rail.castShadow = true; rail.receiveShadow = true; S.add(rail);
      const gold = new T.Mesh(new T.TubeGeometry(ell(RX + 0.2, RZ + 0.2, 0.01), 256, 0.03, 8, true), M.gold); S.add(gold);
      const neon = new T.Mesh(new T.TubeGeometry(ell(RX + 0.98, RZ + 0.98, -0.1), 256, 0.025, 8, true), M.neonRed); S.add(neon);
      const base = new T.Mesh(new T.CylinderGeometry(1, 0.8, 1.1, 96), M.graphite); base.scale.set(RX + 0.6, 1, RZ + 0.6); base.position.y = -0.85; S.add(base);
      // ---------------------------------------------------------------- cartes 3D
      const CW = 0.86, CH = CW * (H / W), cardGeo = new T.BoxGeometry(CW, 0.012, CH);
      const backTex = new T.CanvasTexture(back()); backTex.colorSpace = T.SRGBColorSpace; backTex.anisotropy = 8;
      const edgeM = new T.MeshStandardMaterial({ color: 0xe4ddcc, roughness: 0.6 }), backM = new T.MeshPhysicalMaterial({ map: backTex, roughness: 0.4, clearcoat: 0.5 });
      const fm = new Map();
      const faceMat = (c) => { if (!fm.has(c)) { const t = new T.CanvasTexture(face(c)); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; fm.set(c, new T.MeshPhysicalMaterial({ map: t, roughness: 0.38, clearcoat: 0.4, envMapIntensity: 0.5 })); } return fm.get(c); };
      // la face est sur +y ; rotation.z = π => carte retournée (dos visible)
      const cardMesh = (c) => { const m = new T.Mesh(cardGeo, [edgeM, edgeM, c == null ? backM : faceMat(c), backM, edgeM, edgeM]); m.castShadow = true; return m; };
      const DECK = new T.Vector3(0, 0.05, -1.6);
      const deckG = new T.Group(); for (let i = 0; i < 8; i++) { const m = cardMesh(null); m.position.set(DECK.x, 0.01 + i * 0.013, DECK.z); m.rotation.set(0, (Math.random() - 0.5) * 0.05, 0); deckG.add(m); } S.add(deckG);
      // ---------------------------------------------------------------- jetons
      const DEN = [[500, "#e8b54a", "#0b0c10"], [100, "#16171d", "#e8b54a"], [25, "#178a5e", "#f3efe6"], [5, "#d3163d", "#f3efe6"], [1, "#ece8df", "#d3163d"]];
      const chipGeo = new T.CylinderGeometry(0.22, 0.22, 0.06, 40);
      const chipMats = DEN.map(([, c, s]) => {
        const side = G3.canvasTex(T, 256, 32, (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); g.fillStyle = s; for (let i = 0; i < 8; i++) g.fillRect(i * 32 + 8, 0, 14, h); });
        const face = G3.canvasTex(T, 128, 128, (g, w) => { g.fillStyle = c; g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); g.fill(); g.strokeStyle = s; g.lineWidth = 12; g.setLineDash([16, 12]); g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 8, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); g.lineWidth = 3; g.beginPath(); g.arc(w / 2, w / 2, w * 0.3, 0, Math.PI * 2); g.stroke(); });
        const mk = (map) => new T.MeshStandardMaterial({ map, roughness: 0.38, metalness: 0.08 }); const f = mk(face); return [mk(side), f, f];
      });
      const pile = (amount) => {
        const g = new T.Group(); let left = Math.max(0, amount | 0), col = 0; const cols = [];
        for (let d = 0; d < DEN.length && cols.length < 5; d++) { let k = Math.floor(left / DEN[d][0]); left -= k * DEN[d][0]; while (k > 0 && cols.length < 5) { const h = Math.min(k, 10); cols.push([d, h]); k -= h; } }
        cols.forEach(([d, h], ci) => { const ox = (ci % 3 - (Math.min(cols.length, 3) - 1) / 2) * 0.47, oz = Math.floor(ci / 3) * 0.46;
          for (let j = 0; j < h; j++) { const m = new T.Mesh(chipGeo, chipMats[d]); m.position.set(ox + (Math.random() - 0.5) * 0.015, 0.03 + j * 0.062, oz + (Math.random() - 0.5) * 0.015); m.rotation.y = Math.random() * 6; m.castShadow = true; g.add(m); } col++; });
        return g;
      };
      // bouton de donneur
      const dTex = G3.canvasTex(T, 128, 128, (g, w) => { g.fillStyle = "#f4efe4"; g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); g.fill(); g.strokeStyle = "#e8b54a"; g.lineWidth = 8; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 6, 0, Math.PI * 2); g.stroke(); g.fillStyle = "#0b0c10"; g.font = "900 70px Inter, Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("D", w / 2, w / 2 + 4); });
      const dMat = new T.MeshStandardMaterial({ map: dTex, roughness: 0.4 }), dBtn = new T.Mesh(new T.CylinderGeometry(0.24, 0.24, 0.07, 40), [M.ivory, dMat, dMat]); dBtn.castShadow = true; S.add(dBtn);
      // ---------------------------------------------------------------- sièges
      const me0 = Math.max(0, P.findIndex((p) => p.human));
      let viewerIdx = me0;
      const viewer = () => viewerIdx;
      const ang = (i) => Math.PI / 2 + (((i - viewer() + n) % n) / n) * Math.PI * 2;
      const at = (i, k, y) => new T.Vector3(Math.cos(ang(i)) * RX * k, y || 0, Math.sin(ang(i)) * RZ * k);
      const betAt = (i) => at(i, i === viewer() ? 0.5 : 0.56, 0.01), holeAt = (i) => at(i, 0.74, 0.02), POT = new T.Vector3(0, 0.01, 0.95);
      const holes = P.map(() => new T.Group()), bets = P.map(() => new T.Group()); holes.forEach((g) => S.add(g)); bets.forEach((g) => S.add(g));
      let potG = new T.Group(); S.add(potG);
      const boardG = new T.Group(); S.add(boardG);
      const slot = (k) => new T.Vector3((k - 2) * (CW + 0.12), 0.02, -0.35);
      // ---------------------------------------------------------------- HUD
      const layer = document.createElement("div"); layer.className = "pk-layer"; api.stage.appendChild(layer);
      api.hud.innerHTML = `<div class="pk-raise" id="pk-raise" hidden><div class="pk-pre"></div><input type="range" id="pk-rng"><button class="btn pri" id="pk-ok"></button></div>
        <div class="pk-acts" id="pk-acts" hidden><button class="btn" data-a="fold">Se coucher</button><button class="btn" data-a="call"></button><button class="btn" data-a="raise"></button><button class="btn pk-all" data-a="allin">Tapis</button></div>
        <div class="pk-me"><div class="pk-hand" id="pk-hand"></div><div class="pk-info" id="pk-info"></div></div>`;
      const $ = (q) => api.hud.querySelector(q);
      const lastAct = Array(n).fill("");
      const fmt = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
      const proj = (v) => { const rc = S.renderer.domElement.getBoundingClientRect(), p = v.clone().project(S.camera); return [((p.x + 1) / 2) * rc.width, ((1 - p.y) / 2) * rc.height]; };
      const drawLayer = () => {
        const pot = PK.pot(st), streetBets = (st.bets || []).reduce((a, b) => a + b, 0), [px, py] = proj(POT);
        let h = st.result ? "" : `<div class="pk-pot" style="left:${px}px;top:${py + 26}px">Pot ${fmt(pot)}</div>`; void streetBets;
        h += P.map((p, i) => { if (i === viewer()) return ""; let [x, y] = proj(at(i, 1.13, 0.3)); const vw = api.stage.clientWidth || 360; x = Math.max(62, Math.min(vw - 62, x)); const out = st.chips[i] <= 0 && !(st.hole[i] || []).length;
          return `<div class="pk-seat${st.turn === i ? " on" : ""}${st.folded[i] ? " off" : ""}" style="left:${x}px;top:${y}px">${p.img ? `<img src="${esc(p.img)}" alt="">` : `<span class="ph">${esc(p.name.slice(0, 2))}</span>`}<div><b>${esc(p.name)}</b><small>${out ? "Éliminé" : fmt(st.chips[i])}</small></div>${lastAct[i] ? `<i>${esc(lastAct[i])}</i>` : ""}</div>`; }).join("");
        layer.innerHTML = h;
      };
      const renderMe = () => {
        const i = viewer(), cards = st.hole[i] || [], show = !curtain && cards.length;
        const key = (show ? "s" : "h") + cards.join(","); const hb = $("#pk-hand"); if (hb.dataset.k !== key) { hb.dataset.k = key; hb.innerHTML = show ? cards.map((c, k) => `<img class="pk-c" src="${faceURL(c)}" style="--r:${k ? 6 : -6}deg" alt="${PK.label(c)}">`).join("") : cards.length ? `<span class="pk-c bk"></span><span class="pk-c bk"></span>` : ""; }
        const hv = show && st.board.length >= 3 ? PK.HANDS[PK.evaluate(cards.concat(st.board))[0]] : "";
        $("#pk-info").innerHTML = `<b>${esc(P[i].name)}</b><span>${fmt(st.chips[i])} jetons</span>${st.folded[i] && cards.length ? "<em>Couché</em>" : hv ? `<em>${hv}</em>` : ""}${lastAct[i] ? `<i>${esc(lastAct[i])}</i>` : ""}`;
        $("#pk-hand").classList.toggle("off", !!st.folded[i]);
      };
      const renderActs = () => {
        const i = st.turn, mine = i >= 0 && !st.result && P[i].human && i === viewer() && !curtain && !busy, box = $("#pk-acts");
        box.hidden = !mine; if (!mine) { $("#pk-raise").hidden = true; return; }
        const op = PK.options(st);
        box.querySelector('[data-a="fold"]').hidden = op.check;
        box.querySelector('[data-a="call"]').textContent = op.check ? "Parole" : op.call >= st.chips[i] ? "Tapis " + fmt(op.call) : "Suivre " + fmt(op.call);
        const rb = box.querySelector('[data-a="raise"]'); rb.hidden = !op.canRaise || op.minRaiseTo >= op.maxTo; rb.textContent = st.toCall > 0 ? "Relancer" : "Miser";
        box.querySelector('[data-a="allin"]').hidden = !op.canRaise;
      };
      const status = () => { const i = st.turn; if (st.result || i < 0) return; const p = P[i]; api.turn(p.human ? (setup.mode === "local" && P.filter((x) => x.human).length > 1 ? p.name : "À toi") : p.name + " réfléchit", i === viewer() ? 0 : 1); };
      const paint = () => { drawLayer(); renderMe(); renderActs(); status(); };
      // ---------------------------------------------------------------- 3D : synchronisation et animations
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const placeDealer = () => { const p = at(st.dealer, 0.66, 0.035), side = new T.Vector3(-Math.sin(ang(st.dealer)), 0, Math.cos(ang(st.dealer))).multiplyScalar(0.62); dBtn.position.copy(p.add(side)); };
      const rebuildBets = (arr) => P.forEach((p, i) => { const g = bets[i]; g.clear(); const v = (arr || st.bets || [])[i] || 0; if (v > 0) { const pl = pile(v); pl.position.copy(betAt(i)); g.add(pl); } });
      const rebuildPot = (amount) => { S.scene.remove(potG); potG = pile(amount); potG.position.copy(POT); S.add(potG); };
      const flyGroup = (g, to, dur) => { const from = g.position.clone(); return G3.tween(dur || 0.35, (k) => { g.position.lerpVectors(from, to, k); g.position.y = from.y + Math.sin(k * Math.PI) * 0.5; }); };
      const sweep = async () => { const any = bets.some((g) => g.children.length); if (!any) return; api.sound("move"); await Promise.all(bets.map((g) => (g.children.length ? flyGroup(g, POT.clone().sub(betAt(bets.indexOf(g))).setY(0.02), 0.32) : null)));
        bets.forEach((g) => { g.clear(); g.position.set(0, 0, 0); }); };
      const dealHoles = async () => {
        holes.forEach((g) => g.clear()); boardG.clear();
        const seats = P.map((_, i) => i).filter((i) => (st.hole[i] || []).length);
        for (let r = 0; r < 2; r++) for (const i of seats) {
          if (i === viewer()) continue;
          const m = cardMesh(st.hole[i][r]); m.rotation.z = Math.PI; m.position.copy(DECK); m.position.y = 0.2; S.add(m);
          const side = new T.Vector3(-Math.sin(ang(i)), 0, Math.cos(ang(i))), to = holeAt(i).add(side.multiplyScalar((r - 0.5) * 0.5)); to.y = 0.02 + r * 0.014;
          G3.tween(0.28, (k) => { m.position.lerpVectors(DECK, to, k); m.position.y = 0.2 + (to.y - 0.2) * k + Math.sin(k * Math.PI) * 0.4; m.rotation.y = (r - 0.5) * 0.22 * k; }).then(() => { S.scene.remove(m); holes[i].add(m); });
          api.sound("move"); await wait(70);
        }
        await wait(260);
      };
      const syncBoard = async () => {
        for (let k = boardG.children.length; k < st.board.length; k++) {
          const m = cardMesh(st.board[k]); m.rotation.z = Math.PI; m.position.copy(DECK); boardG.add(m); const to = slot(k);
          await G3.tween(0.34, (t) => { m.position.lerpVectors(DECK, to, t); m.position.y = 0.05 + Math.sin(t * Math.PI) * 0.6; m.rotation.z = Math.PI * (1 - t); });
          m.position.copy(to); m.rotation.z = 0; api.sound("move"); await wait(90);
        }
      };
      const reveal = async (seats) => {
        await Promise.all(seats.filter((i) => i !== viewer() && holes[i].children.length).map((i) => Promise.all(holes[i].children.map((m) => G3.tween(0.4, (k) => { m.rotation.z = Math.PI * (1 - k); m.position.y = 0.03 + Math.sin(k * Math.PI) * 0.35; }).then(() => { m.rotation.z = 0; m.rotation.y = 0; m.position.y = 0.03; })))));
      };
      const foldCards = (i) => { if (i === viewer()) return; holes[i].children.forEach((m) => { const from = m.position.clone(); G3.tween(0.3, (k) => { m.position.lerpVectors(from, DECK, k); m.position.y = from.y + Math.sin(k * Math.PI) * 0.4; }).then(() => holes[i].remove(m)); }); };
      // ---------------------------------------------------------------- déroulement
      let busy = false, curtain = false, alive = true, lastHuman = -1;
      const label = (i, a, toCallBefore) => a.type === "fold" ? "Couché" : a.type === "check" ? "Parole" : a.type === "call" ? (st.allin[i] ? "Tapis" : "Suit") : st.allin[i] ? "Tapis" : (toCallBefore > 0 ? "Relance " : "Mise ") + fmt(st.bets[i]);
      const doAct = async (i, a) => {
        busy = true; const street = st.street, hand = st.hand, before = st.toCall, betsBefore = st.bets.slice(), totBefore = st.total.slice();
        if (!PK.act(st, a)) { busy = false; return; }
        lastAct[i] = label(i, a, before);
        if (a.type === "fold") foldCards(i);
        else if (a.type !== "check") { api.sound(a.type === "call" ? "move" : "capture"); if (a.type === "allin") api.vibrate([10, 30, 10]); }
        if (st.street === street && !st.result) { rebuildBets(st.bets); paint(); await wait(260); busy = false; return next(); }
        // fin de manche : le moteur a remis les mises à zéro ; on montre les mises finales puis on les balaie vers le pot
        const fin = betsBefore.slice(); fin[i] += st.total[i] - totBefore[i]; void hand;
        rebuildBets(fin); paint(); await wait(380); await sweep(); rebuildPot(PK.pot(st));
        if (!st.result) lastAct.forEach((v, j) => { if (v !== "Couché" && v !== "Tapis") lastAct[j] = ""; });
        await syncBoard();
        if (st.result) return finishHand();
        paint(); await wait(200); busy = false; return next();
      };
      const finishHand = async () => {
        const res = st.result; paint(); layer.querySelectorAll(".pk-pot").forEach((x) => x.remove());
        if (res.showdown) await reveal(Object.keys(res.hands).map(Number));
        const winners = res.won.map((w, j) => [w, j]).filter(([w]) => w > 0);
        const txt = winners.map(([w, j]) => `${P[j].name} remporte ${fmt(w)}`).join(" · "), hname = res.showdown && winners.length ? res.hands[winners[0][1]] : "";
        // le pot part chez le(s) gagnant(s)
        if (winners.length) { const w = winners[0][1]; await flyGroup(potG, at(w, w === viewer() ? 0.62 : 0.8, 0.02), 0.5); }
        S.scene.remove(potG); potG = new T.Group(); S.add(potG);
        P.forEach((_, j) => (lastAct[j] = ""));
        const ban = document.createElement("div"); ban.className = "pk-res"; ban.innerHTML = `<b>${esc(txt)}</b>${hname ? `<small>${esc(hname)}</small>` : ""}<button class="btn">Main suivante</button>`; api.stage.appendChild(ban);
        api.turn(winners.some(([, j]) => P[j].human) ? "Pot gagné" : "Main terminée", winners.some(([, j]) => j === viewer()) ? 0 : 1);
        if (winners.some(([, j]) => P[j].human)) api.vibrate([10, 30, 10]);
        renderMe(); drawLayer();
        await new Promise((r) => { const tm = setTimeout(r, 3400); ban.querySelector("button").onclick = () => { clearTimeout(tm); r(); }; });
        ban.remove(); if (!alive) return;
        if (bots && st.chips[me0] <= 0) { const lead = st.chips.indexOf(Math.max(...st.chips)); return api.end(lead, "Tu n'as plus de jetons."); }
        if (st.hand % 10 === 0) { st.sb *= 2; st.bb *= 2; api.toast(`Blindes ${fmt(st.sb)} / ${fmt(st.bb)}`, ""); }
        PK.newHand(st);
        if (st.over) { busy = false; paint(); return api.end(st.over.winner, `${fmt(st.chips[st.over.winner])} jetons après ${st.hand} main${st.hand > 1 ? "s" : ""}.`); }
        return startHand();
      };
      const startHand = async () => {
        busy = true; placeDealer(); rebuildPot(0); rebuildBets(); paint();
        await dealHoles(); renderMe(); busy = false;
        if (st.result) { await syncBoard(); return finishHand(); }
        next();
      };
      const next = async () => {
        if (!alive || st.over || busy) return; paint();
        const i = st.turn; if (i < 0) return;
        if (!P[i].human) {
          busy = true; await wait(600 + Math.random() * 600); if (!alive) return;
          return doAct(i, PK.botAct(st, P[i].level || setup.level || "normal"));
        }
        if (setup.mode === "local" && P.filter((p) => p.human).length > 1 && lastHuman !== i) { lastHuman = i; return showCurtain(i); }
      };
      const showCurtain = (i) => {
        curtain = true; paint(); const cv = document.createElement("div"); cv.className = "ch-curtain"; cv.innerHTML = `<div><small>Passe le téléphone</small><h2>${esc(P[i].name)}</h2><button class="btn pri">Voir mes cartes</button></div>`; api.stage.appendChild(cv);
        cv.querySelector("button").onclick = () => { cv.remove(); curtain = false; if (viewerIdx !== i) { viewerIdx = i; relayout(); } paint(); };
      };
      // en local, la table tourne pour que le joueur au trait soit en bas
      const relayout = () => { holes.forEach((g) => g.clear()); P.forEach((_, i) => { if (i === viewer() || !(st.hole[i] || []).length || st.folded[i]) return; st.hole[i].forEach((c, r) => { const m = cardMesh(c); m.rotation.z = Math.PI; const side = new T.Vector3(-Math.sin(ang(i)), 0, Math.cos(ang(i))); m.position.copy(holeAt(i).add(side.multiplyScalar((r - 0.5) * 0.5))); m.position.y = 0.02 + r * 0.014; m.rotation.y = (r - 0.5) * 0.22; holes[i].add(m); }); }); rebuildBets(); placeDealer(); };
      // ---------------------------------------------------------------- interactions
      const human = (a) => { if (busy || curtain || st.result || !P[st.turn] || !P[st.turn].human || st.turn !== viewer()) return; $("#pk-raise").hidden = true; doAct(st.turn, a); };
      $("#pk-acts").addEventListener("click", (e) => {
        const b = e.target.closest("[data-a]"); if (!b) return; const op = PK.options(st); if (!op) return; const k = b.dataset.a;
        if (k === "fold") return human({ type: "fold" });
        if (k === "call") return human(op.check ? { type: "check" } : { type: "call" });
        if (k === "allin") return human({ type: "allin" });
        // panneau de relance
        const box = $("#pk-raise"); if (!box.hidden) { box.hidden = true; return; }
        const rng = $("#pk-rng"), pot = PK.pot(st), set = (v) => { v = Math.max(op.minRaiseTo, Math.min(op.maxTo, Math.round(v / 5) * 5)); rng.value = v; $("#pk-ok").textContent = (v >= op.maxTo ? "Tapis " : (st.toCall > 0 ? "Relancer à " : "Miser ")) + fmt(v); };
        rng.min = op.minRaiseTo; rng.max = op.maxTo; rng.step = 5;
        const pre = [["Min", op.minRaiseTo], ["½ pot", st.toCall + Math.round(pot / 2)], ["Pot", st.toCall + pot], ["×3", st.toCall * 3 || st.bb * 3]].filter(([, v]) => v >= op.minRaiseTo && v < op.maxTo);
        box.querySelector(".pk-pre").innerHTML = pre.map(([l, v]) => `<button data-v="${v}">${l}</button>`).join("");
        box.querySelectorAll("[data-v]").forEach((x) => (x.onclick = () => set(+x.dataset.v)));
        rng.oninput = () => set(+rng.value); set(op.minRaiseTo); box.hidden = false;
      });
      $("#pk-ok").onclick = () => { const v = +$("#pk-rng").value, op = PK.options(st); if (!op) return; human(v >= op.maxTo ? { type: "allin" } : { type: "raise", to: v }); };
      const onResize = () => drawLayer(); window.addEventListener("resize", onResize);
      setTimeout(drawLayer, 80);
      startHand();
      return { destroy: () => { alive = false; window.removeEventListener("resize", onResize); S.dispose(); }, _st: () => st, _act: (a) => human(a), _busy: () => busy };
    },
  });
})();
