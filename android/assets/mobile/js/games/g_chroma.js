"use strict";
// CHROMA 3D : table ronde (feutre cramoisi, liseré d'or), pioche et défausse en 3D, éventails des adversaires autour de la table,
// anneau lumineux à la couleur demandée, ta main en bas (cartes nettes, éventail). Une carte jouée vole jusqu'à la défausse.
// Local : rideau « passe le téléphone » entre deux joueurs humains. Bots : CHROMA (js/games/chroma_rules.js) décide.
(() => {
  const E = window.ENOS, G3 = E.g3d, C = E.chroma, esc = E.esc;
  if (!E.jeux || !G3 || !C) return;
  const HEX = { c: "#ef1748", y: "#1acfd6", g: "#e8b54a", v: "#8b5cf6", k: "#0b0c10" };
  const RULES = `<p>Pose une carte de la <b>même couleur</b>, du <b>même chiffre</b> ou du <b>même symbole</b>. Les cartes noires se posent toujours et te laissent choisir la couleur.</p>
    <p><b>Gel</b> : le suivant passe. <b>Retour</b> : on change de sens. <b>+2</b> : le suivant pioche 2. <b>Prisme</b> : tu choisis la couleur. <b>+4 Œil</b> : le suivant pioche 4. <b>Échange</b> : tu échanges ta main avec un joueur.</p>
    <p>Pas de carte posable : pioche. Avant de poser ton avant-dernière carte, touche <b>CHROMA</b>, sinon tu pioches 2. Le premier sans carte gagne.</p>`;

  // ------------------------------------------------------------------ dessin des cartes (canvas, partagé entre la 3D et la main)
  const W = 256, H = 384;
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  function icon(g, k, cx, cy, s, col) {
    g.save(); g.translate(cx, cy); g.fillStyle = col; g.strokeStyle = col; g.lineWidth = s * 0.12; g.lineCap = "round"; g.lineJoin = "round";
    if (k === "skip") { g.beginPath(); g.arc(0, 0, s * 0.42, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(-s * 0.3, s * 0.3); g.lineTo(s * 0.3, -s * 0.3); g.stroke(); for (let i = 0; i < 6; i++) { g.save(); g.rotate(i * Math.PI / 3); g.fillRect(-s * 0.03, -s * 0.22, s * 0.06, s * 0.14); g.restore(); } }
    else if (k === "rev") { for (const d of [1, -1]) { g.save(); g.rotate(d === 1 ? 0 : Math.PI); g.beginPath(); g.arc(0, 0, s * 0.34, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); g.beginPath(); g.moveTo(s * 0.34 * Math.cos(Math.PI * 1.9) + s * 0.12, s * 0.34 * Math.sin(Math.PI * 1.9)); g.lineTo(s * 0.34 * Math.cos(Math.PI * 1.9) - s * 0.06, s * 0.34 * Math.sin(Math.PI * 1.9) - s * 0.14); g.lineTo(s * 0.34 * Math.cos(Math.PI * 1.9) - s * 0.08, s * 0.34 * Math.sin(Math.PI * 1.9) + s * 0.12); g.closePath(); g.fill(); g.restore(); } }
    else if (k === "p2" || k === "p4") { g.font = `900 ${s * 0.62}px Inter, Arial`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(k === "p2" ? "+2" : "+4", 0, s * 0.03); }
    else if (k === "wild") { const cs = ["#ef1748", "#1acfd6", "#e8b54a", "#8b5cf6"]; cs.forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, s * 0.42, i * Math.PI / 2 - Math.PI / 4, (i + 1) * Math.PI / 2 - Math.PI / 4); g.closePath(); g.fill(); }); g.fillStyle = "#0b0c10"; g.beginPath(); g.arc(0, 0, s * 0.14, 0, Math.PI * 2); g.fill(); }
    else if (k === "swap") { g.beginPath(); g.moveTo(-s * 0.35, -s * 0.12); g.lineTo(s * 0.3, -s * 0.12); g.stroke(); g.beginPath(); g.moveTo(s * 0.18, -s * 0.26); g.lineTo(s * 0.34, -s * 0.12); g.lineTo(s * 0.18, s * 0.02); g.stroke(); g.beginPath(); g.moveTo(s * 0.35, s * 0.16); g.lineTo(-s * 0.3, s * 0.16); g.stroke(); g.beginPath(); g.moveTo(-s * 0.18, s * 0.02); g.lineTo(-s * 0.34, s * 0.16); g.lineTo(-s * 0.18, s * 0.3); g.stroke(); }
    g.restore();
  }
  function drawEye(g, cx, cy, s) { g.save(); g.translate(cx, cy); const r = g.createRadialGradient(0, 0, 0, 0, 0, s); r.addColorStop(0, "#ff3d63"); r.addColorStop(0.35, "#9e0b26"); r.addColorStop(0.6, "#2a0309"); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.beginPath(); g.arc(0, 0, s, 0, Math.PI * 2); g.fill(); for (let i = 1; i <= 3; i++) { g.strokeStyle = `rgba(255,61,99,${0.5 / i})`; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, s * 0.22 * i, 0, Math.PI * 2); g.stroke(); } g.restore(); }
  function face(card) {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    const col = HEX[card.c], black = card.c === "k";
    rr(g, 2, 2, W - 4, H - 4, 26); const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#1a1b22"); bg.addColorStop(1, "#08090c"); g.fillStyle = bg; g.fill();
    g.lineWidth = 4; g.strokeStyle = black ? "#e8b54a" : col; g.stroke();
    // panneau ovale incliné
    g.save(); g.translate(W / 2, H / 2); g.rotate(-0.42); g.beginPath(); g.ellipse(0, 0, W * 0.36, H * 0.44, 0, 0, Math.PI * 2);
    if (black) { const cs = ["#ef1748", "#1acfd6", "#e8b54a", "#8b5cf6"]; const lg = g.createLinearGradient(-W * 0.36, -H * 0.4, W * 0.36, H * 0.4); cs.forEach((c, i) => lg.addColorStop(i / 3, c)); g.fillStyle = "#0b0c10"; g.fill(); g.lineWidth = 6; g.strokeStyle = lg; g.stroke(); }
    else { const lg = g.createLinearGradient(0, -H * 0.44, 0, H * 0.44); lg.addColorStop(0, col); lg.addColorStop(1, shade(col, -0.45)); g.fillStyle = lg; g.fill(); g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,0.35)"; g.stroke(); }
    g.restore();
    // reflet
    g.save(); rr(g, 2, 2, W - 4, H - 4, 26); g.clip(); const sh = g.createLinearGradient(0, 0, W, H * 0.6); sh.addColorStop(0, "rgba(255,255,255,0.16)"); sh.addColorStop(0.45, "rgba(255,255,255,0)"); g.fillStyle = sh; g.fillRect(0, 0, W, H); g.restore();
    // symbole central
    const fg = black ? "#fff" : "#fff";
    if (card.k === "n") { g.font = "900 150px Inter, Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 10; g.strokeStyle = "rgba(0,0,0,0.45)"; g.strokeText(String(card.v), W / 2, H / 2 + 6); g.fillStyle = fg; g.fillText(String(card.v), W / 2, H / 2 + 6); if (card.v === 6 || card.v === 9) { g.fillRect(W / 2 - 30, H / 2 + 70, 60, 7); } }
    else if (card.k === "p4") { drawEye(g, W / 2, H / 2 - 30, 62); icon(g, "p4", W / 2, H / 2 + 70, 120, "#fff"); }
    else icon(g, card.k, W / 2, H / 2, 150, "#fff");
    // coins
    const small = (x, y, rot) => { g.save(); g.translate(x, y); g.rotate(rot); if (card.k === "n") { g.font = "800 40px Inter, Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = black ? "#e8b54a" : col; g.fillText(String(card.v), 0, 0); } else icon(g, card.k === "p4" ? "p4" : card.k, 0, 0, 44, black ? "#e8b54a" : col); g.restore(); };
    small(34, 40, 0); small(W - 34, H - 40, Math.PI);
    return cv;
  }
  function back() {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    rr(g, 2, 2, W - 4, H - 4, 26); g.fillStyle = "#0a0b0f"; g.fill(); g.lineWidth = 4; g.strokeStyle = "#e8b54a"; g.stroke();
    g.save(); g.translate(W / 2, H / 2); const cs = ["#ef1748", "#1acfd6", "#e8b54a", "#8b5cf6"];
    cs.forEach((c, i) => { g.save(); g.rotate(i * Math.PI / 2 + Math.PI / 4); const lg = g.createLinearGradient(0, 0, 0, -150); lg.addColorStop(0, c); lg.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = lg; g.beginPath(); g.moveTo(-8, 0); g.lineTo(-26, -150); g.lineTo(26, -150); g.lineTo(8, 0); g.closePath(); g.fill(); g.restore(); });
    g.fillStyle = "#e8b54a"; g.beginPath(); g.moveTo(0, -34); g.lineTo(30, 18); g.lineTo(-30, 18); g.closePath(); g.fill(); g.fillStyle = "#0a0b0f"; g.beginPath(); g.moveTo(0, -20); g.lineTo(18, 10); g.lineTo(-18, 10); g.closePath(); g.fill();
    g.restore(); g.font = "800 22px Rajdhani, Inter, Arial"; g.textAlign = "center"; g.fillStyle = "rgba(232,181,74,0.85)"; g.fillText("CHROMA", W / 2, H - 34);
    return cv;
  }
  function shade(hex, k) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, gg = (n >> 8) & 255, b = n & 255; const f = (x) => Math.max(0, Math.min(255, Math.round(k < 0 ? x * (1 + k) : x + (255 - x) * k))); return `rgb(${f(r)},${f(gg)},${f(b)})`; }
  const urlCache = new Map();
  const faceURL = (card) => { const k = card.c + card.k + (card.v != null ? card.v : ""); if (!urlCache.has(k)) urlCache.set(k, face(card).toDataURL("image/png")); return urlCache.get(k); };

  E.jeux.register({
    id: "chroma", title: "CHROMA", sub: "Le jeu de cartes d'ETO, de 2 à 6 joueurs", hero: "img/games/common/hub_bg.webp", min: 2, max: 6, rules: RULES,
    icon: '<rect x="4" y="5" width="10" height="14" rx="2"/><path d="M10 5.5l7.5 2a2 2 0 0 1 1.4 2.4l-2.4 9a2 2 0 0 1-2.5 1.4"/>',
    async start(host, setup, api) {
      const P = setup.players, n = P.length, bots = setup.mode === "bots";
      let st = C.newGame(n, (Date.now() ^ (Math.random() * 1e9)) >>> 0);
      const TW = 16.2, EL = 62 * Math.PI / 180;                 // la table entière (sièges compris) tient à l'écran, vue plongeante
      const S = await G3.stage(host, { intro: { yaw: 0.7 }, bloom: { strength: 0.45, threshold: 0.9 }, fov: 42, exposure: 1.0, fog: 0.012, cam: [0, 14, 8], look: [0, 0, 0],
        fit: (cam, ar) => { const vf = cam.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * ar);
          const d = Math.max((TW / 2) / Math.tan(hf / 2), (TW * Math.sin(EL) * 0.62) / Math.tan(vf / 2)) + 1.5;
          cam.position.set(0, d * Math.sin(EL), d * Math.cos(EL)); cam.lookAt(0, 0, 1.6); } });
      const T = S.T, M = S.mats;
      G3.backdrop(S, { y: -0.4, glow: 22 });
      // table
      const felt = G3.canvasTex(T, 1024, 1024, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w / 2); r.addColorStop(0, "#7a0c22"); r.addColorStop(1, "#2a030b"); g.fillStyle = r; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? 0 : 255},0,0,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
        g.strokeStyle = "rgba(232,181,74,0.25)"; g.lineWidth = 3; g.beginPath(); g.arc(w / 2, h / 2, w * 0.3, 0, Math.PI * 2); g.stroke(); });
      const top = new T.Mesh(new T.CylinderGeometry(7.2, 7.2, 0.3, 96), [new T.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.3, metalness: 0.4 }), new T.MeshStandardMaterial({ map: felt, roughness: 0.95 }), M.obsidian]);
      top.position.y = -0.15; top.receiveShadow = true; S.add(top);
      const rail = new T.Mesh(new T.TorusGeometry(7.25, 0.32, 24, 128), M.obsidian); rail.rotation.x = Math.PI / 2; rail.position.y = 0.02; rail.castShadow = true; S.add(rail);
      const goldLine = new T.Mesh(new T.TorusGeometry(6.88, 0.035, 8, 128), M.gold); goldLine.rotation.x = Math.PI / 2; goldLine.position.y = 0.03; S.add(goldLine);
      // anneau de couleur au centre
      const ringMat = new T.MeshBasicMaterial({ color: 0xef1748, toneMapped: false, transparent: true, opacity: 0.95 });
      const ring = new T.Mesh(new T.TorusGeometry(2.25, 0.05, 10, 96), ringMat); ring.rotation.x = Math.PI / 2; ring.position.set(0, 0.04, 0.2); S.add(ring);
      S.onFrame((dt, t) => { ringMat.opacity = 0.7 + 0.3 * Math.sin(t * 3); ring.rotation.z += dt * 0.2; });
      // cartes 3D
      const CW = 1.15, CH = CW * 1.5, cardGeo = new T.BoxGeometry(CW, 0.012, CH);
      const backTex = new T.CanvasTexture(back()); backTex.colorSpace = T.SRGBColorSpace; backTex.anisotropy = 8;
      const edgeM = new T.MeshStandardMaterial({ color: 0x15161c, roughness: 0.5 }), backM = new T.MeshStandardMaterial({ map: backTex, roughness: 0.45 });
      const faceMats = new Map();
      const faceMat = (card) => { const k = card.c + card.k + (card.v != null ? card.v : ""); if (!faceMats.has(k)) { const t = new T.CanvasTexture(face(card)); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; faceMats.set(k, new T.MeshPhysicalMaterial({ map: t, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2 })); } return faceMats.get(k); };
      const cardMesh = (card) => { const m = new T.Mesh(cardGeo, [edgeM, edgeM, card ? faceMat(card) : backM, backM, edgeM, edgeM]); m.castShadow = true; return m; };
      // pioche
      const DRAW = new T.Vector3(-1.1, 0, 0.2), DISC = new T.Vector3(1.1, 0, 0.2);
      const pile = new T.Group(); S.add(pile);
      const drawPile = () => { pile.clear(); const k = Math.min(14, Math.ceil(st.deck.length / 6)); for (let i = 0; i < k; i++) { const m = cardMesh(null); m.position.set(DRAW.x + (Math.random() - 0.5) * 0.03, 0.01 + i * 0.014, DRAW.z + (Math.random() - 0.5) * 0.03); m.rotation.y = (Math.random() - 0.5) * 0.06; pile.add(m); } };
      const discard = new T.Group(); S.add(discard);
      const pushDiscard = (card, mesh) => { const m = mesh || cardMesh(card); m.position.set(DISC.x + (Math.random() - 0.5) * 0.2, 0.01 + discard.children.length * 0.013, DISC.z + (Math.random() - 0.5) * 0.2); m.rotation.set(0, (Math.random() - 0.5) * 0.7, 0); discard.add(m); if (discard.children.length > 18) discard.remove(discard.children[0]); };
      pushDiscard(C.top(st));
      // adversaires : éventails de dos de cartes autour de la table
      const seats = []; const me0 = P.findIndex((p) => p.human);
      const seatAngle = (i) => { const k = (i - viewer() + n) % n; return Math.PI / 2 + (k / n) * Math.PI * 2; };      // 0 = en bas (spectateur)
      const fans = P.map(() => { const g = new T.Group(); S.add(g); return g; });
      const viewer = () => (bots ? me0 : st.turn != null && P[st.turn].human ? st.turn : me0);
      const layoutFans = () => {
        fans.forEach((g, i) => {
          g.clear(); if (i === viewer()) return;
          const a = seatAngle(i), R = 5.4, cx = Math.cos(a) * R, cz = Math.sin(a) * R, cnt = st.hands[i].length, spread = Math.min(0.16, 1.4 / Math.max(1, cnt));
          for (let j = 0; j < Math.min(cnt, 14); j++) { const m = cardMesh(null); const off = (j - (Math.min(cnt, 14) - 1) / 2) * spread; m.position.set(cx + Math.cos(a + Math.PI / 2) * off * 2, 0.02 + j * 0.012, cz - Math.sin(a + Math.PI / 2) * off * 2); m.rotation.y = -a + Math.PI / 2 + off * 0.8; m.scale.setScalar(0.8); g.add(m); }
          g.userData.pos = new T.Vector3(cx, 0.3, cz);
        });
        seatsHud();
      };
      // HUD : sièges (noms, nombre de cartes) projetés sur l'écran, main du joueur, boutons
      const seatsEl = document.createElement("div"); seatsEl.className = "ch-seats"; seatsEl.id = "ch-seats"; api.stage.appendChild(seatsEl);
      api.hud.innerHTML = `<div class="ch-act"><button class="btn ch-say" id="ch-say" hidden>CHROMA !</button><button class="btn" id="ch-pass" hidden>Garder</button></div><div class="ch-hand" id="ch-hand"></div>`;
      const $ = (q) => api.hud.querySelector(q);
      const seatsHud = () => {
        const box = seatsEl, rc = S.renderer.domElement.getBoundingClientRect();
        box.innerHTML = P.map((p, i) => { if (i === viewer()) return ""; const pos = fans[i].userData.pos; if (!pos) return ""; const v = pos.clone().project(S.camera);
          return `<div class="ch-seat${st.turn === i ? " on" : ""}" style="left:${((v.x + 1) / 2) * rc.width}px;top:${((1 - v.y) / 2) * rc.height}px">${p.img ? `<img src="${esc(p.img)}" alt="">` : `<span class="ph">${esc(p.name.slice(0, 2))}</span>`}<b>${esc(p.name)}</b><i>${st.hands[i].length}</i></div>`; }).join("");
      };
      const playableIds = () => { const i = st.turn; if (!P[i].human) return new Set(); let l = C.playable(st, i); if (st.drawn) l = l.filter((c) => c.id === st.drawn.id); return new Set(l.map((c) => c.id)); };
      const renderHand = () => {
        const i = viewer(), hand = st.hands[i], ok = playableIds(), mine = st.turn === i && P[i].human && !curtain;
        const box = $("#ch-hand"); const k = hand.length, maxW = Math.min((api.stage.clientWidth || window.innerWidth) - 64, 560), step = k > 1 ? Math.min(62, (maxW - 86) / (k - 1)) : 0;
        box.style.width = (86 + step * (k - 1)) + "px";
        box.innerHTML = hand.map((c, j) => { const a = (j - (k - 1) / 2) * Math.min(5, 40 / k); return `<button class="ch-card${mine && ok.has(c.id) ? " ok" : mine ? " no" : ""}" data-id="${c.id}" style="left:${j * step}px;transform:rotate(${a}deg) translateY(${Math.abs(a) * 1.3}px);z-index:${j}"><img src="${faceURL(c)}" alt=""></button>`; }).join("");
        $("#ch-say").hidden = !(mine && hand.length === 2 && !st.said[i] && ok.size);
        $("#ch-pass").hidden = !(mine && st.drawn);
      };
      const colorName = () => C.COLOR_NAME[st.color];
      const status = () => { const p = P[st.turn]; api.turn((p.human ? (n > 1 && setup.mode === "local" ? p.name : "À toi") : p.name + " joue") + " · " + colorName(), st.turn === viewer() ? 0 : 1); ringMat.color.set(HEX[st.color]); };
      // animation : carte qui vole d'un point à la défausse
      const fly = (card, from) => new Promise((res) => { const m = cardMesh(card); m.position.copy(from); S.add(m); const to = new T.Vector3(DISC.x, 0.02 + discard.children.length * 0.013, DISC.z), y0 = from.y, rot0 = m.rotation.y;
        G3.tween(0.42, (k) => { m.position.lerpVectors(from, to, k); m.position.y = y0 + (to.y - y0) * k + Math.sin(k * Math.PI) * 1.4; m.rotation.y = rot0 + k * 1.6; m.rotation.z = Math.sin(k * Math.PI) * 0.3; }).then(() => { S.scene.remove(m); pushDiscard(card); res(); }); });
      const handPos = () => { const v = new T.Vector3(0, 0, 0); const rc = S.renderer.domElement.getBoundingClientRect(); return S.ground(rc.left + rc.width / 2, rc.top + rc.height * 0.88, 0.6) || v.set(0, 0.6, 6); };
      // un tour
      let busy = false, curtain = false, alive = true;
      const after = async (res, who, card) => {
        if (card) { api.sfx("card.place"); const sp = { skip: "chroma.skip", rev: "chroma.rev", wild: "chroma.wild", p2: "chroma.plus", p4: "chroma.plus", swap: "chroma.swap" }[card.k]; if (sp) api.sfx(sp, { delay: 0.08 }); if (card.k !== "n") api.vibrate(14); if (res.penalty) { api.sfx("chroma.penalty"); } if (res.penalty) api.toast(P[who].name + " n'a pas dit CHROMA : +2", "warn"); }
        drawPile(); layoutFans(); renderHand(); status();
        if (st.over) { busy = false; return api.end(st.over.winner); }
        await new Promise((r) => setTimeout(r, 160));
        busy = false; next();
      };
      const play = async (who, a) => {
        busy = true; const card = st.hands[who].find((c) => c.id === a.id); if (!card) { busy = false; return; }
        const from = who === viewer() ? handPos() : (fans[who].userData.pos || new T.Vector3(0, 0.4, -4)).clone();
        const res = C.act(st, a); if (!res.ok) { busy = false; api.toast(res.err, "warn"); return; }
        renderHand(); layoutFans(); await fly(card, from);
        if (card.c === "k") api.toast(P[who].name + " choisit " + colorName(), "");
        return after(res, who, card);
      };
      const drawAct = async (who) => {
        busy = true; const res = C.act(st, { type: "draw" }); api.sfx("card.slide");
        const m = cardMesh(null); m.position.copy(DRAW); m.position.y = 0.3; S.add(m); const to = who === viewer() ? handPos() : (fans[who].userData.pos || new T.Vector3(0, 0.4, -4));
        await G3.tween(0.32, (k) => { m.position.lerpVectors(new T.Vector3(DRAW.x, 0.3, DRAW.z), to, k); m.position.y += Math.sin(k * Math.PI) * 0.8; }); S.scene.remove(m);
        return after(res, who, null);
      };
      const askColor = () => new Promise((res) => { const s = E.ui.sheet({ title: "Choisis la couleur", html: `<div class="ch-colors">${C.COLORS.map((c) => `<button data-c="${c}" style="--c:${HEX[c]}">${C.COLOR_NAME[c]}</button>`).join("")}</div>`, onClose: () => res(C.bestColor(st.hands[st.turn])) });
        s.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { res(b.dataset.c); E.ui.closeSheet(true); })); });
      const askTarget = () => new Promise((res) => { const me = st.turn; const s = E.ui.sheet({ title: "Échanger ta main avec…", options: P.map((p, i) => i === me ? null : { label: `${p.name} · ${st.hands[i].length} carte${st.hands[i].length > 1 ? "s" : ""}`, fn: () => res(i) }).filter(Boolean), onClose: () => res(C.fewestCards(st, me)) }); void s; });
      const next = async () => {
        if (!alive || st.over) return; status(); renderHand();
        const i = st.turn;
        if (!P[i].human) {
          busy = true; await new Promise((r) => setTimeout(r, 650 + Math.random() * 450)); if (!alive || st.over) return; if (st.turn !== i) { busy = false; return next(); }
          const a = C.botTurn(st, P[i].level || "normal"); if (a.say) { C.act(st, { type: "say" }); api.toast(P[i].name + " : CHROMA !", ""); }
          if (a.type === "play") return play(i, a); if (a.type === "draw") return drawAct(i); C.act(st, a); return after({ ok: true }, i, null);
        }
        if (setup.mode === "local" && P.filter((p) => p.human).length > 1 && lastHuman !== i) { lastHuman = i; return showCurtain(i); }
      };
      let lastHuman = -1;
      const showCurtain = (i) => { curtain = true; renderHand(); const cv = document.createElement("div"); cv.className = "ch-curtain"; cv.innerHTML = `<div><small>Passe le téléphone</small><h2>${esc(P[i].name)}</h2><button class="btn pri">Voir ma main</button></div>`; api.stage.appendChild(cv);
        cv.querySelector("button").onclick = () => { cv.remove(); curtain = false; layoutFans(); renderHand(); }; };
      // interactions
      $("#ch-hand").addEventListener("click", async (e) => {
        const b = e.target.closest(".ch-card"); if (!b || busy || curtain || st.over) return; const i = st.turn; if (!P[i].human || i !== viewer()) return;
        const id = +b.dataset.id, card = st.hands[i].find((c) => c.id === id); if (!playableIds().has(id)) { api.vibrate(8); return api.toast("Cette carte ne se pose pas maintenant.", "warn"); }
        const a = { type: "play", id };
        if (card.c === "k") a.color = await askColor();
        if (card.k === "swap") a.target = await askTarget();
        play(i, a);
      });
      $("#ch-say").onclick = () => { C.act(st, { type: "say" }); api.sfx("chroma.call"); api.toast("CHROMA !", "ok"); api.vibrate([10, 20, 10]); renderHand(); };
      $("#ch-pass").onclick = () => { if (busy) return; C.act(st, { type: "pass" }); after({ ok: true }, st.turn, null); };
      S.renderer.domElement.addEventListener("click", (e) => { if (busy || curtain || st.over || !P[st.turn].human || st.drawn) return; const hit = S.ground(e.clientX, e.clientY, 0.05); if (hit && hit.distanceTo(DRAW) < 1.2) drawAct(st.turn); });
      window.addEventListener("resize", seatsHud);
      { let was = true; S.onFrame(() => { const on = S.introActive(); if (on || was) seatsHud(); was = on; }); }
      drawPile(); layoutFans(); renderHand(); status(); setTimeout(seatsHud, 60); setTimeout(() => api.sfx("card.shuffle", { vol: 0.6 }), 300); next();
      return { destroy: () => { alive = false; window.removeEventListener("resize", seatsHud); S.dispose(); }, _st: () => st, _draw: () => drawAct(st.turn), _play: (id, color, target) => play(st.turn, { type: "play", id, color, target }) };
    },
  });
})();
