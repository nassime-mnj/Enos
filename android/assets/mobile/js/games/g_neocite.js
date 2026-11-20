"use strict";
// NÉO-CITÉ 3D : plateau carré d'obsidienne (32 cases en relief, bandeaux de quartier, illustrations des cases spéciales),
// ville miniature lumineuse au centre, pions en verre teinté, dés 3D lancés, antennes et tours posées sur les lots.
// Règles et bots : js/games/neocite_rules.js. Local : chacun joue à son tour sur le même téléphone.
(() => {
  const E = window.ENOS, G3 = E.g3d, N = E.neocite, esc = E.esc;
  if (!E.jeux || !G3 || !N) return;
  const RULES = `<p>Lance les dés et avance. Sur un lot libre : achète-le ou mets-le aux <b>enchères</b> (chacun fait une offre, la plus haute l'emporte).</p>
    <p>Possède les <b>3 lots d'un quartier</b> : le loyer double et tu peux y poser des <b>antennes</b> (1 à 3) puis une <b>tour</b>.</p>
    <p><b>Rachat</b> : avec 2 lots d'un quartier, tu peux racheter le 3e à son propriétaire pour 2 fois son prix (s'il n'est pas bâti).</p>
    <p><b>Relais</b> : téléporte-toi à l'autre Relais pour 50. <b>Audit</b> : direction le <b>Pare-feu</b> (sortie en payant 50, sur un double ou avec un laissez-passer).
    Amendes et taxes vont à la <b>Réserve</b> : celui qui s'y arrête la remporte. Passer par le Départ rapporte 200.</p>`;
  const PCOL = ["#ef1748", "#1acfd6", "#e8b54a", "#8b5cf6", "#22c55e", "#f3ead9"];
  const IMG = "img/games/capital/";
  const fmt = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " cr";
  const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const wrap = (g, txt, maxW) => { const words = txt.split(" "), lines = []; let cur = ""; for (const w of words) { const t = cur ? cur + " " + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines; };

  E.jeux.register({
    id: "neocite", title: "Néo-Cité", sub: "Le jeu de plateau immobilier d'ETO, de 2 à 6 joueurs", hero: IMG + "table_bg.webp", min: 2, max: 6, rules: RULES,
    icon: '<path d="M4 20V10l4-3v13M10 20V5l5-2v17M17 20v-9l3 2v7"/><path d="M3 20h18"/>',
    options: [{ key: "rounds", label: "Durée", def: 40, choices: [[20, "20 tours"], [40, "40 tours"], [0, "Jusqu'à la faillite"]] },
      { key: "cash", label: "Capital de départ", def: 1500, choices: [[1000, "1 000"], [1500, "1 500"], [2000, "2 000"]] }],
    async start(host, setup, api) {
      const P = setup.players, n = P.length, o = setup.opts || {};
      const st = N.newGame(n, { cash: +o.cash || 1500, rounds: o.rounds == null ? 40 : +o.rounds, seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0 });
      const C = 1.6, W1 = 1.0, SIDE = 2 * C + 7 * W1, HALF = SIDE / 2, EL = 66 * Math.PI / 180;
      const S = await G3.stage(host, { intro: { yaw: 0.9, d: 2.6 }, bloom: { strength: 0.5, threshold: 0.88 }, fov: 40, exposure: 1.0, fog: 0.008, cam: [0, 14, 9], look: [0, 0, 0],
        fit: (cam, ar) => { const vf = cam.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * ar), span = SIDE + 0.9;
          const d = Math.max((span / 2) / Math.tan(hf / 2), (span * Math.sin(EL) * 0.62) / Math.tan(vf / 2)) + 1.0;
          cam.position.set(0, d * Math.sin(EL), d * Math.cos(EL) + 0.9); cam.lookAt(0, 0, 0.9); } });
      const T = S.T, M = S.mats;
      G3.backdrop(S, { y: -0.6, glow: 24 });
      // ---------------------------------------------------------------- socle
      const base = new T.Mesh(G3.roundedBox(T, SIDE + 0.7, 0.4, SIDE + 0.7, 0.35, 4), M.obsidian); base.position.y = -0.22; base.receiveShadow = true; S.add(base);
      const rim = new T.Mesh(G3.roundedBox(T, SIDE + 0.78, 0.06, SIDE + 0.78, 0.38, 2), M.gold); rim.position.y = -0.44; S.add(rim);
      for (const [x, z, w, d] of [[0, -HALF - 0.33, SIDE, 0.03], [0, HALF + 0.33, SIDE, 0.03], [-HALF - 0.33, 0, 0.03, SIDE], [HALF + 0.33, 0, 0.03, SIDE]]) { const m = new T.Mesh(new T.BoxGeometry(w, 0.02, d), M.neonRed); m.position.set(x, -0.01, z); S.add(m); }
      // ---------------------------------------------------------------- cases
      const tileInfo = (i) => { const s = Math.floor(i / 8), k = i % 8, corner = k === 0;
        const t = corner ? HALF - C / 2 : HALF - C - (k - 0.5) * W1, e = HALF - C / 2;
        const pos = [[-e, t], [-t, -e], [e, -t], [t, e]][s], rot = [-Math.PI / 2, Math.PI, Math.PI / 2, 0][s];
        return { x: pos[0], z: pos[1], rot, corner, s }; };
      const arts = {}; await Promise.all(["start", "firewall", "recharge", "audit", "signal", "relay"].map(async (k) => (arts[k] = await loadImg(IMG + "tile_" + k + ".webp"))));
      const ART = { start: "start", jail: "firewall", reserve: "recharge", audit: "audit", signal: "signal", relay: "relay" };
      const tileTex = (i) => { const b = N.BOARD[i], corner = i % 8 === 0, cw = corner ? 400 : 256, ch = 410;
        return G3.canvasTex(T, cw, ch, (g, w, h) => {
          const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, "#15161c"); bg.addColorStop(1, "#08090c"); g.fillStyle = bg; g.fillRect(0, 0, w, h);
          g.strokeStyle = "rgba(232,181,74,.35)"; g.lineWidth = 3; g.strokeRect(4, 4, w - 8, h - 8);
          g.textAlign = "center"; g.fillStyle = "#f2efe8";
          if (b.type === "lot") { const col = N.DIST[b.d].color; const band = g.createLinearGradient(0, 0, 0, 78); band.addColorStop(0, col); band.addColorStop(1, col + "aa"); g.fillStyle = band; g.fillRect(8, 8, w - 16, 74);
            g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(8, 8, w - 16, 10);
            g.fillStyle = "#f2efe8"; g.font = "800 30px Inter, Arial"; wrap(g, b.name.toUpperCase(), w - 34).slice(0, 3).forEach((l, k) => g.fillText(l, w / 2, 140 + k * 36));
            g.fillStyle = "rgba(255,255,255,.4)"; g.font = "600 20px Inter, Arial"; g.fillText(N.DIST[b.d].name, w / 2, 290);
            g.fillStyle = "#e8b54a"; g.font = "800 34px Inter, Arial"; g.fillText(fmt(b.price), w / 2, h - 40); return; }
          const art = arts[ART[b.type]];
          if (art) { const sz = corner ? 300 : 200; g.save(); g.globalAlpha = 0.95; g.drawImage(art, (w - sz) / 2, corner ? 30 : 46, sz, sz); g.restore(); }
          g.font = `800 ${corner ? 40 : 30}px Inter, Arial`; g.fillStyle = b.type === "audit" || b.type === "jail" ? "#ff3d63" : b.type === "signal" ? "#1acfd6" : "#f2efe8";
          g.fillText(b.name.toUpperCase(), w / 2, corner ? h - 56 : 300);
          if (b.type === "relay") { g.fillStyle = "#e8b54a"; g.font = "800 32px Inter, Arial"; g.fillText(fmt(b.price), w / 2, h - 40); }
          if (b.type === "start") { g.fillStyle = "#e8b54a"; g.font = "700 24px Inter, Arial"; g.fillText("+200 à chaque passage", w / 2, h - 22); }
        }); };
      const tiles = [], tileGroups = [];
      const tileGeo = G3.roundedBox(T, W1 * 0.95, 0.14, C * 0.96, 0.06, 2), cornerGeo = G3.roundedBox(T, C * 0.97, 0.14, C * 0.97, 0.08, 2);
      for (let i = 0; i < N.SIZE; i++) {
        const ti = tileInfo(i), g = new T.Group(); g.position.set(ti.x, 0, ti.z); g.rotation.y = ti.rot; S.add(g); tileGroups.push(g);
        const side = new T.MeshStandardMaterial({ color: 0x0d0e12, roughness: 0.4, metalness: 0.3 });
        const body = new T.Mesh(ti.corner ? cornerGeo : tileGeo, side); body.position.y = 0.07; body.receiveShadow = true; g.add(body);
        const top = new T.Mesh(new T.PlaneGeometry(ti.corner ? C * 0.9 : W1 * 0.88, C * 0.9), new T.MeshStandardMaterial({ map: tileTex(i), roughness: 0.42, metalness: 0.05 }));
        top.rotation.x = -Math.PI / 2; top.position.y = 0.145; top.receiveShadow = true; top.userData.sq = i; g.add(top); tiles.push(top);
        const deco = new T.Group(); g.add(deco); g.userData.deco = deco;
      }
      // ---------------------------------------------------------------- centre : ville miniature
      const center = new T.Mesh(new T.PlaneGeometry(SIDE - 2 * C - 0.1, SIDE - 2 * C - 0.1), new T.MeshStandardMaterial({ map: G3.canvasTex(T, 1024, 1024, (g, w, h) => {
        const r = g.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, w * 0.7); r.addColorStop(0, "#1a0610"); r.addColorStop(1, "#07080b"); g.fillStyle = r; g.fillRect(0, 0, w, h);
        g.strokeStyle = "rgba(239,23,72,.12)"; g.lineWidth = 2; for (let k = 0; k <= 16; k++) { g.beginPath(); g.moveTo(k * w / 16, 0); g.lineTo(k * w / 16, h); g.stroke(); g.beginPath(); g.moveTo(0, k * h / 16); g.lineTo(w, k * h / 16); g.stroke(); }
        g.textAlign = "center"; g.fillStyle = "#e8b54a"; g.font = "800 92px Inter, Arial"; g.fillText("NÉO-CITÉ", w / 2, h * 0.86); g.fillStyle = "rgba(242,239,232,.45)"; g.font = "600 30px Inter, Arial"; g.fillText("8 QUARTIERS · 24 LOTS", w / 2, h * 0.93);
      }), roughness: 0.6 }));
      center.rotation.x = -Math.PI / 2; center.position.y = 0.005; S.add(center);
      const winTex = G3.canvasTex(T, 64, 128, (g, w, h) => { g.fillStyle = "#0a0b0f"; g.fillRect(0, 0, w, h); for (let y = 8; y < h - 6; y += 9) for (let x = 7; x < w - 6; x += 10) { const r = Math.random(); g.fillStyle = r < 0.32 ? "rgba(255,196,170,.85)" : r < 0.4 ? "rgba(255,61,99,.8)" : "rgba(30,31,40,1)"; g.fillRect(x, y, 5, 4); } });
      winTex.wrapS = winTex.wrapT = T.RepeatWrapping;
      const winM = new T.MeshStandardMaterial({ color: 0x111218, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 1.0, roughness: 0.25, metalness: 0.5 });
      const city = new T.Group(); S.add(city);
      // îlots en grille, plus hauts vers la Spire ; avenues vides en croix
      for (let gx = -3; gx <= 3; gx++) for (let gz = -3; gz <= 2; gz++) {
        if (gx === 0 || gz === 0 || (gz === 2 && Math.abs(gx) < 2)) continue;
        const cx = gx * 0.5, cz = gz * 0.5 - 0.55, dist = Math.hypot(gx, gz * 1.1);
        for (const [ox, oz] of [[-0.1, -0.1], [0.1, 0.1], [0.1, -0.1], [-0.1, 0.1]]) { if (Math.random() < 0.25) continue;
          const h = Math.max(0.12, (2.1 - dist * 0.42) * (0.45 + Math.random() * 0.6)), w = 0.13 + Math.random() * 0.05;
          const m = new T.Mesh(new T.BoxGeometry(w, h, w), winM); m.position.set(cx + ox, h / 2, cz + oz); m.castShadow = true; m.receiveShadow = true; city.add(m);
          if (h > 0.9) { const cap = new T.Mesh(new T.BoxGeometry(w * 0.6, 0.04, w * 0.6), M.gold); cap.position.set(cx + ox, h + 0.02, cz + oz); city.add(cap); } }
      }
      for (const [w, d, x, z] of [[3.6, 0.05, 0, -0.55], [0.05, 3.1, 0, -0.55]]) { const av = new T.Mesh(new T.BoxGeometry(w, 0.01, d), M.neonRed); av.position.set(x, 0.01, z); city.add(av); }
      const spire = new T.Mesh(new T.CylinderGeometry(0.03, 0.16, 2.6, 8), M.obsidian); spire.position.set(0, 1.3, -0.55); city.add(spire);
      const eye = new T.Mesh(new T.SphereGeometry(0.13, 24, 16), M.neonRed); eye.position.set(0, 2.66, -0.55); city.add(eye);
      S.onFrame((dt, t) => { eye.material.emissiveIntensity = 2 + Math.sin(t * 2.4) * 0.8; });
      // paquet Signal
      const backTex = await G3.loadTex(T, IMG + "card_signal_back.webp");
      const deckM = new T.MeshStandardMaterial({ map: backTex, roughness: 0.4 }), deck = new T.Group();
      for (let k = 0; k < 7; k++) { const m = new T.Mesh(new T.BoxGeometry(0.9, 0.02, 1.3), [M.graphite, M.graphite, deckM, M.graphite, M.graphite, M.graphite]); m.position.set(-2.05, 0.02 + k * 0.022, 1.75); m.rotation.y = 0.25 + (Math.random() - 0.5) * 0.04; m.castShadow = true; deck.add(m); }
      S.add(deck);
      // ---------------------------------------------------------------- pions
      const pawnGeo = new T.LatheGeometry([[0, 0], [0.26, 0], [0.27, 0.05], [0.2, 0.09], [0.12, 0.16], [0.09, 0.38], [0.14, 0.42], [0.1, 0.46], [0.13, 0.55], [0.13, 0.64], [0.08, 0.72], [0, 0.74]].map(([x, y]) => new T.Vector2(x, y)), 40);
      const pawns = P.map((p, i) => { const m = new T.Mesh(pawnGeo, new T.MeshPhysicalMaterial({ color: PCOL[i], roughness: 0.15, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, transmission: 0, sheen: 0.2 }));
        m.castShadow = true; const ring = new T.Mesh(new T.TorusGeometry(0.27, 0.02, 8, 40), new T.MeshBasicMaterial({ color: PCOL[i], toneMapped: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.01; m.add(ring); S.add(m); return m; });
      const pawnSpot = (i, sq) => { const ti = tileInfo(sq), k = i - (n - 1) / 2, side = new T.Vector3(Math.cos(ti.rot), 0, -Math.sin(ti.rot)), along = new T.Vector3(Math.sin(ti.rot), 0, Math.cos(ti.rot));
        const off = side.multiplyScalar((i % 3 - 1) * 0.3).add(along.multiplyScalar((Math.floor(i / 3) - 0.5) * 0.36 + 0.18)); void k; return new T.Vector3(ti.x + off.x, 0.15, ti.z + off.z); };
      const placePawns = () => pawns.forEach((m, i) => { m.visible = !st.out[i]; m.position.copy(pawnSpot(i, st.pos[i])); });
      // ---------------------------------------------------------------- dés
      const pipTex = (v) => G3.canvasTex(T, 128, 128, (g, w) => { g.fillStyle = "#0d0e12"; g.fillRect(0, 0, w, w); rr(g, 6, 6, w - 12, w - 12, 18); g.strokeStyle = "rgba(232,181,74,.6)"; g.lineWidth = 3; g.stroke();
        const P2 = { 1: [[0.5, 0.5]], 2: [[0.28, 0.28], [0.72, 0.72]], 3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]], 4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]], 5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]], 6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]] }[v];
        for (const [x, y] of P2) { const gr = g.createRadialGradient(x * w, y * w, 0, x * w, y * w, 13); gr.addColorStop(0, "#ff7a95"); gr.addColorStop(0.5, "#ef1748"); gr.addColorStop(1, "rgba(239,23,72,0)"); g.fillStyle = gr; g.beginPath(); g.arc(x * w, y * w, 13, 0, Math.PI * 2); g.fill(); } });
      const FACE = [3, 4, 1, 6, 2, 5];                                        // ordre des faces de BoxGeometry : +x, -x, +y, -y, +z, -z
      const dieMats = FACE.map((v) => new T.MeshPhysicalMaterial({ map: pipTex(v), roughness: 0.25, clearcoat: 1, emissive: 0xffffff, emissiveMap: pipTex(v), emissiveIntensity: 0.25 }));
      const dice = [0, 1].map(() => { const m = new T.Mesh(new T.BoxGeometry(0.5, 0.5, 0.5), dieMats); m.castShadow = true; m.position.set(0, -2, 0); S.add(m); return m; });
      const faceQ = (v) => { const e = { 1: [0, 0, 0], 6: [Math.PI, 0, 0], 2: [-Math.PI / 2, 0, 0], 5: [Math.PI / 2, 0, 0], 3: [0, 0, Math.PI / 2], 4: [0, 0, -Math.PI / 2] }[v]; return new T.Quaternion().setFromEuler(new T.Euler(e[0], e[1], e[2])); };
      const rollDice = async (vals) => {
        api.sfx("dice.throw");
        await Promise.all(dice.map((m, k) => { const to = new T.Vector3(k ? 0.42 : -0.42, 0.25, 1.75), from = new T.Vector3(to.x + (Math.random() - 0.5) * 2, 2.4, 3.6);
          const qEnd = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), (Math.random() - 0.5) * 1.2).multiply(faceQ(vals[k])), spin = new T.Vector3(Math.random() * 14 + 8, Math.random() * 10, Math.random() * 14 + 6);
          return G3.tween(0.75 + k * 0.08, (t) => { m.position.lerpVectors(from, to, t); m.position.y = to.y + Math.abs(Math.cos(t * Math.PI * 2.2)) * (1 - t) * 1.6;
            if (t < 0.82) m.rotation.set(spin.x * (1 - t), spin.y * (1 - t), spin.z * (1 - t)); else m.quaternion.slerp(qEnd, (t - 0.82) / 0.18 + 0.05); }).then(() => m.quaternion.copy(qEnd)); }));
        api.vibrate(8);
      };
      // ---------------------------------------------------------------- bâtiments et propriétaires
      const antennaGeo = new T.CylinderGeometry(0.035, 0.07, 0.42, 10), lightGeo = new T.SphereGeometry(0.05, 12, 8), towerGeo = G3.roundedBox(T, 0.34, 0.8, 0.34, 0.05, 2);
      const refreshDeco = () => tileGroups.forEach((g, i) => {
        const d = g.userData.deco; d.clear(); const ow = st.own[i]; if (!ow) return; const ti = tileInfo(i), w = ti.corner ? C : W1;
        const strip = new T.Mesh(new T.BoxGeometry(w * 0.84, 0.04, 0.09), new T.MeshBasicMaterial({ color: PCOL[ow.p], toneMapped: false, transparent: true, opacity: ow.mort ? 0.3 : 1 })); strip.position.set(0, 0.16, C / 2 - 0.12); d.add(strip);
        if (ow.mort) { const x = new T.Mesh(new T.BoxGeometry(w * 0.7, 0.01, 0.05), new T.MeshBasicMaterial({ color: 0x888888 })); x.position.set(0, 0.16, 0); x.rotation.y = 0.9; d.add(x); }
        if (ow.lvl === 4) { const t = new T.Mesh(towerGeo, winM); t.position.set(0, 0.55, -C / 2 + 0.38); t.castShadow = true; d.add(t); const cap = new T.Mesh(new T.ConeGeometry(0.2, 0.22, 4), M.gold); cap.position.set(0, 1.06, -C / 2 + 0.38); cap.rotation.y = Math.PI / 4; d.add(cap); }
        else for (let k = 0; k < (ow.lvl || 0); k++) { const a = new T.Mesh(antennaGeo, M.obsidian), x = (k - ((ow.lvl || 0) - 1) / 2) * 0.27; a.position.set(x, 0.36, -C / 2 + 0.36); a.castShadow = true; d.add(a); const l = new T.Mesh(lightGeo, M.neonRed); l.position.set(x, 0.6, -C / 2 + 0.36); d.add(l); }
      });
      // ---------------------------------------------------------------- HUD
      const top = document.createElement("div"); top.className = "nc-players"; api.stage.appendChild(top);
      api.hud.innerHTML = `<div class="nc-log" id="nc-log"></div><div class="nc-deed" id="nc-deed" hidden></div><div class="nc-acts" id="nc-acts"></div>`;
      const $ = (q) => api.hud.querySelector(q);
      const drawPlayers = () => { top.innerHTML = P.map((p, i) => `<div class="nc-pl${st.turn === i ? " on" : ""}${st.out[i] ? " out" : ""}" style="--c:${PCOL[i]}">${p.img ? `<img src="${esc(p.img)}" alt="">` : `<span class="ph">${esc(p.name.slice(0, 2))}</span>`}<div><b>${esc(p.name)}</b><small>${st.out[i] ? "Faillite" : fmt(st.cash[i])}</small></div>${st.jail[i] >= 0 && !st.out[i] ? '<i title="Pare-feu">⛨</i>' : ""}</div>`).join("")
        + `<div class="nc-res">Réserve <b>${fmt(st.reserve)}</b> · Tour ${st.round}${st.maxRounds ? "/" + st.maxRounds : ""}</div>`; };
      const say = (txt) => { $("#nc-log").textContent = txt; };
      const name = (i) => P[i].name;
      const isMine = () => P[st.turn] && P[st.turn].human && !st.out[st.turn];
      const deedHTML = (sq) => { const b = N.BOARD[sq], ow = st.own[sq];
        if (b.type === "relay") return `<div class="nc-card" style="--c:#e8b54a"><small>Relais</small><b>${esc(b.name)}</b><table><tr><td>1 relais</td><td>40 cr</td></tr><tr><td>2 relais</td><td>100 cr</td></tr><tr><td>Téléportation</td><td>50 cr</td></tr></table><p>${ow ? "Propriétaire : " + esc(name(ow.p)) + (ow.mort ? " · hypothéqué" : "") : "Prix : " + fmt(b.price)}</p></div>`;
        if (b.type !== "lot") return `<div class="nc-card"><b>${esc(b.name)}</b></div>`;
        const D = N.DIST[b.d], lv = ["Terrain nu", "Quartier complet", "1 antenne", "2 antennes", "3 antennes", "Tour"], vals = [b.rent[0], b.rent[0] * 2, b.rent[1], b.rent[2], b.rent[3], b.rent[4]];
        return `<div class="nc-card" style="--c:${D.color}"><small>${esc(D.name)}</small><b>${esc(b.name)}</b><table>${lv.map((l, k) => `<tr class="${ow && ((k === 0 && !ow.lvl && !N.hasSet(st, ow.p, b.d)) || (k === 1 && !ow.lvl && N.hasSet(st, ow.p, b.d)) || (k > 1 && ow.lvl === k - 1)) ? "on" : ""}"><td>${l}</td><td>${fmt(vals[k])}</td></tr>`).join("")}</table>
          <p>Antenne ou tour : ${fmt(b.build)} · Hypothèque : ${fmt(b.price / 2)}</p><p>${ow ? "Propriétaire : " + esc(name(ow.p)) + (ow.mort ? " · hypothéqué" : "") : "Prix : " + fmt(b.price)}</p></div>`; };
      const renderActs = () => {
        drawPlayers(); const box = $("#nc-acts"), deed = $("#nc-deed"); deed.hidden = true;
        if (busy || st.over || !isMine()) { box.innerHTML = ""; return; }
        const p = st.turn, ph = st.phase, B = (a, l, cls, dis) => `<button class="btn${cls ? " " + cls : ""}" data-a="${a}"${dis ? " disabled" : ""}>${l}</button>`;
        let h = "";
        if (ph === "jailed") h = B("roll", "Tenter un double", "pri") + B("jpay", "Payer 50 cr", "", st.cash[p] < N.JAIL_FEE) + (st.passes[p] ? B("jpass", "Laissez-passer") : "");
        else if (ph === "roll") h = B("roll", "Lancer les dés", "pri") + B("manage", "Gérer");
        else if (ph === "buy") { const b = N.BOARD[st.pending]; deed.hidden = false; deed.innerHTML = deedHTML(st.pending); h = B("buy", "Acheter " + fmt(b.price), "pri", st.cash[p] < b.price) + B("auction", "Enchères"); }
        else if (ph === "relay") h = B("relay1", "Téléportation · 50 cr", "pri", st.cash[p] < 50) + B("relay0", "Rester");
        else if (ph === "end") h = B("end", "Fin du tour", "pri") + B("manage", "Gérer");
        box.innerHTML = h;
        api.turn(setup.mode === "local" && P.filter((x) => x.human).length > 1 ? name(p) : "À toi", 0);
      };
      // ---------------------------------------------------------------- animations d'événements
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const hop = (i, from, to) => { const m = pawns[i], a = m.position.clone(), b = pawnSpot(i, to); return G3.tween(0.16, (t) => { m.position.lerpVectors(a, b, t); m.position.y = 0.15 + Math.sin(t * Math.PI) * 0.4; }); };
      const movePawn = async (i, from, to, direct) => {
        if (direct) { const m = pawns[i], a = m.position.clone(), b = pawnSpot(i, to); await G3.tween(0.6, (t) => { m.position.lerpVectors(a, b, t); m.position.y = 0.15 + Math.sin(t * Math.PI) * 2.2; }); return; }
        const fwd = (to - from + N.SIZE) % N.SIZE, back = (from - to + N.SIZE) % N.SIZE, dir = fwd <= 12 || back > 6 ? 1 : -1, steps = dir > 0 ? fwd : back;
        if (steps > 14) return movePawn(i, from, to, true);
        let cur = from; for (let k = 0; k < steps; k++) { const nx = (cur + dir + N.SIZE) % N.SIZE; await hop(i, cur, nx); cur = nx; api.sfx("nc.hop", { intensity: 0.6 }); }
      };
      const floatText = (sq, txt, col) => { const ti = tileInfo(sq), v = new T.Vector3(ti.x, 0.6, ti.z).project(S.camera), rc = S.renderer.domElement.getBoundingClientRect();
        const el = document.createElement("div"); el.className = "nc-float"; el.style.cssText = `left:${((v.x + 1) / 2) * rc.width}px;top:${((1 - v.y) / 2) * rc.height}px;color:${col || "#e8b54a"}`; el.textContent = txt; api.stage.appendChild(el); setTimeout(() => el.remove(), 1500); };
      const showCard = (text) => new Promise((res) => { const el = document.createElement("div"); el.className = "nc-signal"; el.innerHTML = `<div><small>Signal</small><p>${esc(text)}</p></div>`; api.stage.appendChild(el); api.sfx("nc.card");
        const done = () => { el.remove(); res(); }; const tm = setTimeout(done, P[st.turn] && P[st.turn].human ? 2600 : 1900); el.onclick = () => { clearTimeout(tm); done(); }; });
      const run = async (ev) => {
        for (const e of ev) {
          if (e.t === "dice") { await rollDice(e.dice); say(`${name(e.p)} fait ${e.dice[0]} + ${e.dice[1]}${e.dice[0] === e.dice[1] ? " · double" : ""}`); await wait(150); }
          else if (e.t === "move") { await movePawn(e.p, e.from, e.to, Math.abs(e.to - e.from) > 12 && (e.to === N.RELAYS[0] || e.to === N.RELAYS[1]) && N.BOARD[e.from].type === "relay"); }
          else if (e.t === "salary") { floatText(0, "+200", "#22c55e"); }
          else if (e.t === "rent") { say(`${name(e.p)} paie ${fmt(e.amount)} de loyer à ${name(e.to)}`); floatText(e.sq, "−" + fmt(e.amount), "#ff3d63"); api.sfx("nc.pay"); await wait(500); }
          else if (e.t === "card") { await showCard(e.text); }
          else if (e.t === "jail") { say(`${name(e.p)} part au Pare-feu`); api.sfx("nc.jail"); await movePawn(e.p, st.pos[e.p], N.JAIL, true); api.vibrate(20); }
          else if (e.t === "free") say(`${name(e.p)} sort du Pare-feu${e.paid ? " (50 cr)" : ""}`);
          else if (e.t === "reserve") { say(`${name(e.p)} remporte la Réserve : ${fmt(e.amount)}`); floatText(N.RESERVE, "+" + fmt(e.amount), "#22c55e"); api.sfx("nc.reserve"); await wait(500); }
          else if (e.t === "mort") say(`${name(e.p)} hypothèque ${N.BOARD[e.sq].name}`);
          else if (e.t === "bankrupt") { say(`${name(e.p)} fait faillite`); api.toast(`${name(e.p)} fait faillite`, "warn"); api.sfx("nc.bankrupt"); pawns[e.p].visible = false; await wait(700); }
          refreshDeco(); drawPlayers();
        }
        refreshDeco(); drawPlayers();
      };
      // ---------------------------------------------------------------- enchères
      const askBid = (j) => new Promise((res) => { const sq = st.pending, b = N.BOARD[sq], cash = st.cash[j];
        const opts = [...new Set([0.5, 0.75, 1, 1.25, 1.5].map((f) => Math.floor((b.price * f) / 5) * 5).filter((v) => v > 0 && v <= cash))];
        E.ui.sheet({ title: `Enchère · ${b.name}` + (P.filter((p) => p.human).length > 1 ? ` · ${name(j)}` : ""), html: `<p class="muted" style="margin-bottom:10px">Offre sous pli fermé. Prix normal ${fmt(b.price)} · tu as ${fmt(cash)}.</p>`,
          options: [{ label: "Passer", fn: () => res(0) }].concat(opts.map((v) => ({ label: "Offrir " + fmt(v), fn: () => res(v) }))), onClose: () => res(0) }); });
      const auction = async () => {
        const sq = st.pending, bids = [];
        for (let j = 0; j < n; j++) { if (st.out[j] || j === st.turn) { bids.push(0); continue; } bids.push(P[j].human ? await askBid(j) : N.botBid(st, j, P[j].level || setup.level || "normal")); }
        const w = N.auction(st, bids);
        say(w >= 0 ? `${name(w)} remporte ${N.BOARD[sq].name} pour ${fmt(bids[w])}` : `Personne ne prend ${N.BOARD[sq].name}`);
        if (w >= 0) { floatText(sq, fmt(bids[w]), PCOL[w]); api.sfx("nc.auction"); api.sfx("nc.buy", { delay: 0.25 }); }
        refreshDeco(); drawPlayers(); await wait(700);
      };
      // ---------------------------------------------------------------- gestion (construire, vendre, hypothéquer, racheter)
      const manage = () => {
        const p = st.turn, mine = Object.keys(st.own).map(Number).filter((i) => st.own[i].p === p).sort((a, b) => a - b), take = Object.keys(st.own).map(Number).filter((i) => N.canTakeover(st, p, i));
        const row = (i) => { const b = N.BOARD[i], ow = st.own[i], col = b.type === "lot" ? N.DIST[b.d].color : "#e8b54a", lvl = ow.lvl === 4 ? "Tour" : ow.lvl ? ow.lvl + " antenne" + (ow.lvl > 1 ? "s" : "") : "";
          const btn = (a, l, ok) => `<button data-a="${a}" data-i="${i}"${ok ? "" : " disabled"}>${l}</button>`;
          return `<div class="nc-row" style="--c:${col}"><span><b>${esc(b.name)}</b><small>${ow.mort ? "Hypothéqué" : lvl || (b.type === "lot" && N.hasSet(st, p, b.d) ? "Quartier complet" : "")}</small></span>
            ${b.type === "lot" && ow.lvl < 4 ? btn("build", (ow.lvl === 3 ? "Tour " : "Antenne ") + b.build, N.canBuild(st, p, i)) : ""}${ow.lvl ? btn("sell", "Vendre", N.canSell(st, p, i)) : ""}
            ${ow.mort ? btn("unmort", "Lever " + N.unmortgageCost(i), st.cash[p] >= N.unmortgageCost(i)) : btn("mort", "Hypothéquer", !ow.lvl && !(b.type === "lot" && N.lotsOf(b.d).some((k) => st.own[k] && st.own[k].lvl > 0)))}</div>`; };
        const html = (take.length ? `<h4 class="pl-h4">Rachats possibles</h4>${take.map((i) => `<div class="nc-row" style="--c:${N.DIST[N.BOARD[i].d].color}"><span><b>${esc(N.BOARD[i].name)}</b><small>à ${esc(name(st.own[i].p))}</small></span><button data-a="take" data-i="${i}">Racheter ${N.takeoverCost(i)}</button></div>`).join("")}` : "")
          + (mine.length ? `<h4 class="pl-h4">Tes lots · ${fmt(st.cash[p])}</h4>` + mine.map(row).join("") : `<p class="muted">Tu ne possèdes encore aucun lot.</p>`);
        E.ui.sheet({ title: "Gérer", html: `<div class="nc-manage">${html}</div>`, onOpen: (s) => s.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => {
          const i = +b.dataset.i, a = b.dataset.a; let ok = false;
          if (a === "build") ok = N.build(st, p, i); else if (a === "sell") ok = N.sell(st, p, i); else if (a === "mort") ok = N.mortgage(st, p, i); else if (a === "unmort") ok = N.unmortgage(st, p, i);
          else if (a === "take") { const from = st.own[i].p; ok = N.takeover(st, p, i); if (ok) say(`${name(p)} rachète ${N.BOARD[i].name} à ${name(from)}`); }
          if (ok) { api.sfx(a === "build" ? "nc.build" : a === "take" ? "nc.buy" : "nc.pay"); refreshDeco(); drawPlayers(); manage(); } })) });
      };
      // ---------------------------------------------------------------- déroulement
      let busy = false, alive = true;
      const act = async (fn) => { busy = true; renderActs(); try { await fn(); } finally { busy = false; } if (!alive) return; placePawns(); next(); };
      const finish = () => { const w = st.over.winner; api.end(w, st.over.reason === "last" ? "Tous les autres joueurs ont fait faillite." : `Plus grosse fortune après ${st.maxRounds} tours : ${fmt(N.netWorth(st, w))}.`); };
      const next = async () => {
        if (!alive) return; drawPlayers();
        if (st.over) { renderActs(); return finish(); }
        const p = st.turn;
        if (setup.mode === "bots" && st.out[P.findIndex((x) => x.human)]) { renderActs(); let w = 0; for (let j = 0; j < n; j++) if (!st.out[j] && N.netWorth(st, j) > N.netWorth(st, w)) w = j; return api.end(w, "Tu as fait faillite."); }
        if (P[p].human) { renderActs(); return; }
        // bot
        busy = true; renderActs(); api.turn(name(p) + " joue", 1); const lvl = P[p].level || setup.level || "normal";
        await wait(st.phase === "roll" || st.phase === "jailed" ? 650 : 500); if (!alive) return;
        if (st.phase === "jailed") { const d = N.botJail(st, lvl); if (d === "pass") { N.jailPass(st); say(`${name(p)} utilise un laissez-passer`); } else if (d === "pay") { N.jailPay(st); say(`${name(p)} paie 50 cr pour sortir`); } else await run(N.roll(st)); }
        else if (st.phase === "roll") await run(N.roll(st));
        else if (st.phase === "buy") { if (N.botWantsBuy(st, lvl)) { const sq = st.pending; N.buy(st); say(`${name(p)} achète ${N.BOARD[sq].name}`); floatText(sq, fmt(N.BOARD[sq].price), PCOL[p]); api.sfx("nc.buy"); refreshDeco(); await wait(450); } else await auction(); }
        else if (st.phase === "relay") { const go = N.botRelay(st, lvl); if (go) say(`${name(p)} se téléporte`); await run(N.relay(st, go)); }
        else if (st.phase === "end") { const did = N.botManage(st, p, lvl); if (did.length) { const b = did.filter((x) => x.t === "build").length, tk = did.find((x) => x.t === "takeover"); say(tk ? `${name(p)} rachète ${N.BOARD[tk.sq].name} à ${name(tk.from)}` : b ? `${name(p)} construit (${b})` : `${name(p)} lève une hypothèque`); refreshDeco(); drawPlayers(); api.sfx(tk ? "nc.buy" : "nc.build"); await wait(700); } N.endTurn(st); }
        busy = false; if (!alive) return; placePawns(); next();
      };
      $("#nc-acts").addEventListener("click", (e) => {
        const b = e.target.closest("[data-a]"); if (!b || busy || !isMine()) return; const a = b.dataset.a;
        if (a === "roll") return act(async () => run(N.roll(st)));
        if (a === "jpay") { N.jailPay(st); say(`${name(st.turn)} paie 50 cr pour sortir`); return next(); }
        if (a === "jpass") { N.jailPass(st); return next(); }
        if (a === "buy") { const sq = st.pending; if (N.buy(st)) { say(`${name(st.turn)} achète ${N.BOARD[sq].name}`); floatText(sq, fmt(N.BOARD[sq].price), PCOL[st.turn]); api.sfx("nc.buy"); refreshDeco(); } return next(); }
        if (a === "auction") return act(auction);
        if (a === "relay1" || a === "relay0") return act(async () => run(N.relay(st, a === "relay1")));
        if (a === "end") { N.endTurn(st); say(""); return next(); }
        if (a === "manage") return manage();
      });
      // toucher une case : fiche du lot
      S.renderer.domElement.addEventListener("click", (e) => { const hit = S.pick(e.clientX, e.clientY, tiles)[0]; if (!hit) return; const sq = hit.object.userData.sq, b = N.BOARD[sq]; if (b.type !== "lot" && b.type !== "relay") return;
        const p = st.turn, canTake = isMine() && !busy && N.canTakeover(st, p, sq);
        E.ui.sheet({ title: b.name, html: deedHTML(sq), options: canTake ? [{ label: `Racheter pour ${fmt(N.takeoverCost(sq))}`, fn: () => { const from = st.own[sq].p; if (N.takeover(st, p, sq)) { say(`${name(p)} rachète ${b.name} à ${name(from)}`); refreshDeco(); drawPlayers(); } } }] : [] }); });
      placePawns(); refreshDeco(); drawPlayers(); say("Premier joueur : " + name(0)); next();
      return { destroy: () => { alive = false; S.dispose(); }, _st: () => st, _busy: () => busy, _next: () => next() };
    },
  });
})();
