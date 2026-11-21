"use strict";
// NÉO-CITÉ 3D : plateau d'obsidienne au cœur d'une ville de nuit (gratte-ciel éclairés, projecteurs, drones), 32 cases lisibles
// (grands noms, prix, icônes), ville miniature au centre, pions en verre, dés 3D, antennes et tours posées sur les lots.
// Caméra : vue d'ensemble ou suivi du joueur (le côté où il se trouve passe face à toi) ; pincer pour zoomer, glisser pour se déplacer.
// Règles et bots : js/games/neocite_rules.js. Illustrations optionnelles : js/games/neocite_art.js (liste des images présentes).
(() => {
  const E = window.ENOS, G3 = E.g3d, N = E.neocite, esc = E.esc;
  if (!E.jeux || !G3 || !N) return;
  const RULES = `<p>Lance les dés et avance. Sur un lot libre, <b>achète-le ou refuse</b> : il reste libre.</p>
    <p>Chaque lot d'un même quartier fait <b>monter le loyer de tout le quartier</b> : ×1,75 avec 2 lots, ×2,5 avec les 3. Avec le quartier complet, pose des <b>antennes</b> (1 à 3) puis une <b>tour</b>.</p>
    <p><b>Enchères</b> (coin en bas à droite) : un lot libre est mis aux enchères, chacun fait une offre sous pli fermé. <b>Signal</b> : un événement tiré au hasard.</p>
    <p><b>Échanges</b> : propose des lots et de l'argent aux autres joueurs (lots sans bâtiments). <b>Relais</b> : téléportation à l'autre Relais pour 50 €.</p>
    <p><b>Audit</b> : direction le <b>Pare-feu</b> (sortie en payant 50 €, sur un double ou avec un laissez-passer). Amendes et taxes vont à la <b>Réserve</b>, gagnée par celui qui s'y arrête. Départ : +200 €.</p>
    <p><b>Découvert</b> autorisé jusqu'à −1 500 € ; au-delà, on vend les bâtiments et on hypothèque, sinon c'est la faillite.</p>`;
  const PCOL = ["#ef1748", "#1acfd6", "#e8b54a", "#8b5cf6", "#22c55e", "#f3ead9"];
  const IMG = "img/games/capital/";
  const fmt = (v) => (v < 0 ? "−" : "") + String(Math.round(Math.abs(v))).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f") + "\u00a0€";
  const slug = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const ART = () => window.ENOS_NC_ART || { icons: [], lots: [], cards: [] };
  const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = G3.src(src); });
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const wrap = (g, txt, maxW) => { const words = txt.split(" "), lines = []; let cur = ""; for (const w of words) { const t = cur ? cur + " " + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines; };

  /** icônes vectorielles des cases spéciales (remplacées par icons/<type>.webp si présentes) */
  function icon(g, type, s) {
    g.save(); g.lineWidth = s * 0.07; g.lineCap = "round"; g.lineJoin = "round";
    const R = "#ff3d63", Y = "#e8b54a", C = "#1acfd6";
    if (type === "start") { g.fillStyle = R; g.beginPath(); g.moveTo(-s * 0.42, -s * 0.16); g.lineTo(s * 0.1, -s * 0.16); g.lineTo(s * 0.1, -s * 0.38); g.lineTo(s * 0.46, 0); g.lineTo(s * 0.1, s * 0.38); g.lineTo(s * 0.1, s * 0.16); g.lineTo(-s * 0.42, s * 0.16); g.closePath(); g.fill(); }
    else if (type === "jail") { g.strokeStyle = R; g.beginPath(); g.moveTo(0, -s * 0.44); g.lineTo(s * 0.36, -s * 0.3); g.lineTo(s * 0.32, s * 0.12); g.quadraticCurveTo(s * 0.2, s * 0.36, 0, s * 0.46); g.quadraticCurveTo(-s * 0.2, s * 0.36, -s * 0.32, s * 0.12); g.lineTo(-s * 0.36, -s * 0.3); g.closePath(); g.stroke();
      for (const x of [-0.14, 0, 0.14]) { g.beginPath(); g.moveTo(x * s, -s * 0.2); g.lineTo(x * s, s * 0.26); g.stroke(); } }
    else if (type === "reserve") { g.fillStyle = Y; for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(0, s * (0.26 - k * 0.15), s * 0.34, s * 0.11, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = "#7a5a1c"; g.lineWidth = s * 0.025; g.stroke(); } }
    else if (type === "auction") { g.save(); g.rotate(-0.6); g.fillStyle = Y; rr(g, -s * 0.3, -s * 0.36, s * 0.6, s * 0.24, s * 0.06); g.fill(); g.fillStyle = "#c9c4bb"; g.fillRect(-s * 0.05, -s * 0.12, s * 0.1, s * 0.5); g.restore(); g.strokeStyle = R; g.beginPath(); g.arc(s * 0.12, s * 0.32, s * 0.2, Math.PI * 1.05, Math.PI * 1.95); g.stroke(); g.fillStyle = "#8a6a2a"; g.fillRect(-s * 0.4, s * 0.36, s * 0.5, s * 0.08); }
    else if (type === "audit") { g.strokeStyle = R; g.beginPath(); g.moveTo(-s * 0.46, 0); g.quadraticCurveTo(0, -s * 0.42, s * 0.46, 0); g.quadraticCurveTo(0, s * 0.42, -s * 0.46, 0); g.stroke(); const r = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.18); r.addColorStop(0, "#ffd0da"); r.addColorStop(0.5, R); r.addColorStop(1, "#5a0718"); g.fillStyle = r; g.beginPath(); g.arc(0, 0, s * 0.17, 0, Math.PI * 2); g.fill(); }
    else if (type === "signal") { g.strokeStyle = C; g.fillStyle = C; g.beginPath(); g.moveTo(0, -s * 0.05); g.lineTo(-s * 0.16, s * 0.44); g.moveTo(0, -s * 0.05); g.lineTo(s * 0.16, s * 0.44); g.stroke(); g.beginPath(); g.arc(0, -s * 0.08, s * 0.07, 0, Math.PI * 2); g.fill();
      for (const r of [0.2, 0.34]) { g.beginPath(); g.arc(0, -s * 0.08, s * r, -Math.PI * 0.8, -Math.PI * 0.2); g.stroke(); g.beginPath(); g.arc(0, -s * 0.08, s * r, Math.PI * 0.2 - Math.PI, Math.PI * 0.8 - Math.PI, true); g.stroke(); } }
    else if (type === "relay") { g.strokeStyle = C; g.beginPath(); g.ellipse(0, 0, s * 0.34, s * 0.42, 0, 0, Math.PI * 2); g.stroke(); g.strokeStyle = R; for (const x of [-0.12, 0.12]) { g.beginPath(); g.moveTo(x * s, -s * 0.46); g.lineTo(x * s * 2.4, s * 0.46); g.stroke(); } }
    g.restore();
  }

  E.jeux.register({
    id: "neocite", title: "Néo-Cité", sub: "Le jeu de plateau immobilier d'ETO, de 2 à 6 joueurs", hero: IMG + "table_bg.webp", min: 2, max: 6, rules: RULES,
    icon: '<path d="M4 20V10l4-3v13M10 20V5l5-2v17M17 20v-9l3 2v7"/><path d="M3 20h18"/>',
    options: [{ key: "rounds", label: "Durée", def: 40, choices: [[20, "20 tours"], [40, "40 tours"], [0, "Jusqu'à la faillite"]] },
      { key: "cash", label: "Capital de départ", def: 1500, choices: [[1000, "1 000 €"], [1500, "1 500 €"], [2000, "2 000 €"]] },
      { key: "decor", label: "Décor", def: "nuit", choices: [["nuit", "Ville de nuit"], ["stade", "Stade"], ["sakura", "Sakura"], ["ocean", "Océan"], ["automne", "Automne"], ["rue", "Rue"], ["volcan", "Volcan"], ["tempete", "Tempête"], ["eto", "Arène ETO"]] }],
    async start(host, setup, api) {
      const P = setup.players, n = P.length, o = setup.opts || {}, art = ART();
      const st = N.newGame(n, { cash: +o.cash || 1500, rounds: o.rounds == null ? 40 : +o.rounds, seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0 });
      const C = 1.9, W1 = 1.25, SIDE = 2 * C + 7 * W1, HALF = SIDE / 2, EL = 62 * Math.PI / 180;
      // caméra pilotée : vue d'ensemble (zoom 1) ou suivi ; azimut : le côté du joueur suivi passe face à l'écran
      const cam = { base: 0, az: 0, azT: 0, tx: 0, tz: 0, txT: 0, tzT: 0, zoom: 1, zoomT: 1, follow: true, user: 0 };
      const S = await G3.stage(host, { bloom: { strength: 0.5, threshold: 0.88 }, fov: 40, exposure: 1.0, fog: 0.018, bg: 0x05060a, cam: [0, 14, 9], look: [0, 0, 0],
        fit: (c, ar) => { const vf = c.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * ar), span = SIDE + 0.8;
          cam.base = Math.max((span / 2) / Math.tan(hf / 2), (span * Math.sin(EL) * 0.62) / Math.tan(vf / 2)) + 1.0; placeCam(c); } });
      const T = S.T, M = S.mats;
      function placeCam(c) { const d = cam.base * cam.zoom; c.position.set(cam.tx + Math.sin(cam.az) * Math.cos(EL) * d, d * Math.sin(EL), cam.tz + Math.cos(cam.az) * Math.cos(EL) * d); c.lookAt(cam.tx, 0, cam.tz); }
      // ---------------------------------------------------------------- ville de nuit autour du plateau
      const winTex = G3.canvasTex(T, 64, 128, (g, w, h) => { g.fillStyle = "#0a0b0f"; g.fillRect(0, 0, w, h); for (let y = 8; y < h - 6; y += 9) for (let x = 7; x < w - 6; x += 10) { const r = Math.random(); g.fillStyle = r < 0.3 ? "rgba(255,200,170,.9)" : r < 0.38 ? "rgba(255,61,99,.85)" : r < 0.42 ? "rgba(26,207,214,.8)" : "rgba(30,31,40,1)"; g.fillRect(x, y, 5, 4); } });
      winTex.wrapS = winTex.wrapT = T.RepeatWrapping;
      const winM = new T.MeshStandardMaterial({ color: 0x0f1016, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 1.0, roughness: 0.3, metalness: 0.5 });
      const DC = E.flickDecor, theme = DC && DC.extra && o.decor && o.decor !== "nuit" && DC.IDS.includes(o.decor) ? o.decor : "nuit";
      if (theme !== "nuit") {                                                   // mêmes décors que Flick, montés autour de la table
        const dec = DC.mount(S, theme, { W: SIDE + 2.6, L: SIDE + 2.6 }, -0.36); S.onFrame((dt, t) => dec.update(dt, t));
      } else {
      const floorTex = G3.canvasTex(T, 1024, 1024, (g, w) => { g.fillStyle = "#07080c"; g.fillRect(0, 0, w, w); g.strokeStyle = "rgba(239,23,72,.22)"; g.lineWidth = 3; for (let k = 0; k <= 16; k++) { g.beginPath(); g.moveTo(k * w / 16, 0); g.lineTo(k * w / 16, w); g.stroke(); g.beginPath(); g.moveTo(0, k * w / 16); g.lineTo(w, k * w / 16); g.stroke(); }
          for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,${150 + Math.random() * 80},120,${Math.random() * 0.5})`; const k = Math.floor(Math.random() * 17) * w / 16; Math.random() < 0.5 ? g.fillRect(k - 2, Math.random() * w, 4, 10) : g.fillRect(Math.random() * w, k - 2, 10, 4); } });
        floorTex.wrapS = floorTex.wrapT = T.RepeatWrapping; floorTex.repeat.set(10, 10);
        const floor = new T.Mesh(new T.PlaneGeometry(240, 240), new T.MeshStandardMaterial({ map: floorTex, roughness: 0.32, metalness: 0.65, envMapIntensity: 0.6 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -1.6; floor.receiveShadow = true; S.add(floor);
        S.scene.background = new T.Color(0x05060a);
        const sky = new T.Mesh(new T.SphereGeometry(110, 32, 16), new T.MeshBasicMaterial({ side: T.BackSide, fog: false, toneMapped: false, map: G3.canvasTex(T, 512, 256, (g, w, h) => { const lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, "#020206"); lg.addColorStop(0.55, "#12040b"); lg.addColorStop(0.7, "#3a0716"); lg.addColorStop(1, "#05060a"); g.fillStyle = lg; g.fillRect(0, 0, w, h); for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.7})`; g.fillRect(Math.random() * w, Math.random() * h * 0.45, 1, 1); } }) })); S.add(sky);
        // gratte-ciel instanciés en couronne
        const NB = G3.fx() ? 260 : 120, sky1 = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), winM, NB), dm = new T.Object3D(); let nb = 0;
        for (let i = 0; i < NB * 3 && nb < NB; i++) { const a = Math.random() * Math.PI * 2, r = 17 + Math.pow(Math.random(), 0.7) * 30, x = Math.cos(a) * r, z = Math.sin(a) * r; const h = 2 + Math.random() * (r < 24 ? 7 : 16), w = 0.8 + Math.random() * 1.8;
          dm.position.set(x, -1.6 + h / 2, z); dm.scale.set(w, h, w * (0.7 + Math.random() * 0.6)); dm.rotation.y = Math.random() * 0.4; dm.updateMatrix(); sky1.setMatrixAt(nb++, dm.matrix); }
        sky1.count = nb; S.add(sky1);
        // projecteurs qui balaient le ciel
        const beamT = G3.canvasTex(T, 64, 256, (g, w, h) => { const lg = g.createLinearGradient(0, h, 0, 0); lg.addColorStop(0, "rgba(255,90,120,0.55)"); lg.addColorStop(1, "rgba(255,90,120,0)"); g.fillStyle = lg; g.fillRect(0, 0, w, h); });
        const beams = [[-16, -14], [17, -12], [-20, 8], [19, 10]].map(([x, z], k) => { const b = new T.Mesh(new T.ConeGeometry(1.4, 30, 16, 1, true), new T.MeshBasicMaterial({ map: beamT, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false }));
          b.geometry.translate(0, 15, 0); b.position.set(x, -1.6, z); b.userData.ph = k * 1.7; S.add(b); return b; });
        // drones lumineux
        const ND = 26, drones = new T.InstancedMesh(new T.SphereGeometry(0.07, 8, 6), new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), ND), DR = [];
        for (let i = 0; i < ND; i++) { DR.push({ r: 14 + Math.random() * 14, y: 2 + Math.random() * 6, s: (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.08), a: Math.random() * 6.28 }); drones.setColorAt(i, new T.Color(i % 3 === 0 ? 0x1acfd6 : i % 3 === 1 ? 0xff3d63 : 0xffe0a0)); }
        S.add(drones);
        S.onFrame((dt, t) => { beams.forEach((b) => { b.rotation.z = Math.sin(t * 0.3 + b.userData.ph) * 0.45; b.rotation.x = Math.cos(t * 0.23 + b.userData.ph) * 0.3; });
          DR.forEach((d, i) => { d.a += d.s * dt; dm.position.set(Math.cos(d.a) * d.r, d.y + Math.sin(t + i) * 0.2, Math.sin(d.a) * d.r); dm.scale.setScalar(1); dm.rotation.set(0, 0, 0); dm.updateMatrix(); drones.setMatrixAt(i, dm.matrix); }); drones.instanceMatrix.needsUpdate = true; });
      }
      // ---------------------------------------------------------------- table et socle
      const table = new T.Mesh(G3.roundedBox(T, SIDE + 2.2, 1.2, SIDE + 2.2, 0.5, 4), M.obsidian); table.position.y = -0.95; table.receiveShadow = true; S.add(table);
      const base = new T.Mesh(G3.roundedBox(T, SIDE + 0.7, 0.4, SIDE + 0.7, 0.35, 4), M.obsidian); base.position.y = -0.22; base.receiveShadow = true; S.add(base);
      const rim = new T.Mesh(G3.roundedBox(T, SIDE + 0.78, 0.06, SIDE + 0.78, 0.38, 2), M.gold); rim.position.y = -0.44; S.add(rim);
      for (const [x, z, w, d] of [[0, -HALF - 0.33, SIDE, 0.03], [0, HALF + 0.33, SIDE, 0.03], [-HALF - 0.33, 0, 0.03, SIDE], [HALF + 0.33, 0, 0.03, SIDE]]) { const m = new T.Mesh(new T.BoxGeometry(w, 0.02, d), M.neonRed); m.position.set(x, -0.01, z); S.add(m); }
      // ---------------------------------------------------------------- cases (lisibles : grands noms, prix, icônes)
      const tileInfo = (i) => { const s = Math.floor(i / 8), k = i % 8, corner = k === 0;
        const t = corner ? HALF - C / 2 : HALF - C - (k - 0.5) * W1, e = HALF - C / 2;
        const pos = [[-e, t], [-t, -e], [e, -t], [t, e]][s], rot = [-Math.PI / 2, Math.PI, Math.PI / 2, 0][s];
        return { x: pos[0], z: pos[1], rot, corner, s }; };
      await G3.pack("neocite");
      const icons = {}; await Promise.all((art.icons || []).map(async (k) => (icons[k] = await loadImg(IMG + "icons/" + k + ".webp"))));
      const lotArt = {}; await Promise.all((art.lots || []).map(async (k) => (lotArt[k] = await loadImg(IMG + "lots/" + k + ".webp"))));
      const LABEL = { start: "DÉPART", jail: "PARE-FEU", reserve: "RÉSERVE", auction: "ENCHÈRES", audit: "AUDIT", signal: "SIGNAL" }; void 0;
      const SUB = { start: "+200 € à chaque passage", jail: "Simple visite", reserve: "Remporte la Réserve", auction: "Un lot aux enchères", audit: "Direction Pare-feu", signal: "Événement" };
      const tileTex = (i) => { const b = N.BOARD[i], corner = i % 8 === 0, cw = corner ? 512 : 360, ch = 548;
        return G3.canvasTex(T, cw, ch, (g, w, h) => {
          const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, "#22242e"); bg.addColorStop(1, "#111218"); g.fillStyle = bg; g.fillRect(0, 0, w, h);
          g.strokeStyle = "rgba(232,181,74,.55)"; g.lineWidth = 4; g.strokeRect(5, 5, w - 10, h - 10);
          g.textAlign = "center"; g.textBaseline = "alphabetic";
          const txt = (s, y, font, col) => { g.font = font; g.lineWidth = 8; g.strokeStyle = "rgba(0,0,0,.55)"; g.strokeText(s, w / 2, y); g.fillStyle = col; g.fillText(s, w / 2, y); };
          if (b.type === "lot") { const D = N.DIST[b.d], col = D.color, la = lotArt[slug(b.name)];
            const band = g.createLinearGradient(0, 0, 0, 92); band.addColorStop(0, col); band.addColorStop(1, col + "cc"); g.fillStyle = band; g.fillRect(9, 9, w - 18, 84); g.fillStyle = "rgba(255,255,255,.22)"; g.fillRect(9, 9, w - 18, 12);
            g.fillStyle = "rgba(0,0,0,.6)"; g.font = "800 24px Inter, Arial"; g.fillText(D.name.toUpperCase(), w / 2, 64);
            if (la) { const gl = g.createRadialGradient(w / 2, 250, 10, w / 2, 250, 170); gl.addColorStop(0, col + "55"); gl.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gl; g.fillRect(0, 90, w, 320); const sz = 250; g.drawImage(la, (w - sz) / 2, 100, sz, sz);
              g.font = "900 46px Inter, Arial"; const ln = wrap(g, b.name.toUpperCase(), w - 30).slice(0, 2); ln.forEach((l, k) => txt(l, 392 + k * 46 - (ln.length - 1) * 20, "900 46px Inter, Arial", "#ffffff"));
              txt(fmt(b.price), h - 30, "900 50px Inter, Arial", "#f3c766"); return; }
            g.font = "900 54px Inter, Arial"; const lines = wrap(g, b.name.toUpperCase(), w - 40).slice(0, 3), y0 = 230 - (lines.length - 1) * 30;
            lines.forEach((l, k) => txt(l, y0 + k * 62, "900 54px Inter, Arial", "#ffffff"));
            txt(fmt(b.price), h - 42, "900 58px Inter, Arial", "#f3c766"); return; }
          const ic = icons[b.type === "relay" ? "airport" : b.type], sz = corner ? 300 : 210;
          g.save(); g.translate(w / 2, corner ? 200 : 190); if (ic) g.drawImage(ic, -sz / 2, -sz / 2, sz, sz); else icon(g, b.type, sz); g.restore();
          const label = b.type === "relay" ? b.name.toUpperCase() : LABEL[b.type] || b.name.toUpperCase();
          g.font = `900 ${corner ? 64 : 46}px Inter, Arial`; const lines = wrap(g, label, w - 30);
          lines.forEach((l, k) => txt(l, (corner ? 410 : 360) + k * (corner ? 64 : 50), `900 ${corner ? 64 : 46}px Inter, Arial`, b.type === "audit" || b.type === "jail" ? "#ff6d88" : b.type === "signal" || b.type === "relay" ? "#7ff0f5" : b.type === "auction" || b.type === "reserve" ? "#f3c766" : "#ffffff"));
          txt(b.type === "relay" ? fmt(b.price) : SUB[b.type] || "", h - 40, b.type === "relay" ? "900 52px Inter, Arial" : `700 ${corner ? 34 : 28}px Inter, Arial`, b.type === "relay" ? "#f3c766" : "#d8d4cc");
        }); };
      const tiles = [], tileGroups = [];
      const tileGeo = G3.roundedBox(T, W1 * 0.95, 0.14, C * 0.96, 0.06, 2), cornerGeo = G3.roundedBox(T, C * 0.97, 0.14, C * 0.97, 0.08, 2);
      const sideM = new T.MeshStandardMaterial({ color: 0x0d0e12, roughness: 0.4, metalness: 0.3 });
      for (let i = 0; i < N.SIZE; i++) {
        const ti = tileInfo(i), g = new T.Group(); g.position.set(ti.x, 0, ti.z); g.rotation.y = ti.rot; S.add(g); tileGroups.push(g);
        const body = new T.Mesh(ti.corner ? cornerGeo : tileGeo, sideM); body.position.y = 0.07; body.receiveShadow = true; g.add(body);
        const top = new T.Mesh(new T.PlaneGeometry(ti.corner ? C * 0.92 : W1 * 0.9, C * 0.92), new T.MeshStandardMaterial({ map: tileTex(i), roughness: 0.5, metalness: 0.02, envMapIntensity: 0.3 }));
        top.rotation.x = -Math.PI / 2; top.position.y = 0.145; top.receiveShadow = true; top.userData.sq = i; g.add(top); tiles.push(top);
        const deco = new T.Group(); g.add(deco); g.userData.deco = deco;
      }
      // surbrillance de la case d'arrivée
      const hl = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false })); hl.rotation.x = -Math.PI / 2; hl.position.y = 0.16; S.add(hl);
      const highlight = (sq, col) => { const ti = tileInfo(sq); hl.position.x = ti.x; hl.position.z = ti.z; hl.rotation.z = -ti.rot; hl.scale.set(ti.corner ? C : W1, C, 1); hl.material.color.set(col || "#ffffff"); hl.material.opacity = 0.35; };
      S.onFrame((dt) => { hl.material.opacity = Math.max(0, hl.material.opacity - dt * 0.12); });
      // ---------------------------------------------------------------- centre : ville miniature
      const inner = SIDE - 2 * C - 0.1;
      const center = new T.Mesh(new T.PlaneGeometry(inner, inner), new T.MeshStandardMaterial({ map: G3.canvasTex(T, 1024, 1024, (g, w, h) => {
        const r = g.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, w * 0.7); r.addColorStop(0, "#1a0610"); r.addColorStop(1, "#07080b"); g.fillStyle = r; g.fillRect(0, 0, w, h);
        g.strokeStyle = "rgba(239,23,72,.12)"; g.lineWidth = 2; for (let k = 0; k <= 16; k++) { g.beginPath(); g.moveTo(k * w / 16, 0); g.lineTo(k * w / 16, h); g.stroke(); g.beginPath(); g.moveTo(0, k * h / 16); g.lineTo(w, k * h / 16); g.stroke(); }
        g.textAlign = "center"; g.fillStyle = "#e8b54a"; g.font = "800 92px Inter, Arial"; g.fillText("NÉO-CITÉ", w / 2, h * 0.88); g.fillStyle = "rgba(242,239,232,.5)"; g.font = "600 30px Inter, Arial"; g.fillText("8 QUARTIERS · 24 LOTS", w / 2, h * 0.94);
      }), roughness: 0.6 }));
      center.rotation.x = -Math.PI / 2; center.position.y = 0.005; S.add(center);
      const city = new T.Group(); S.add(city);
      for (let gx = -3; gx <= 3; gx++) for (let gz = -3; gz <= 2; gz++) {
        if (gx === 0 || gz === 0 || (gz === 2 && Math.abs(gx) < 2)) continue;
        const cx = gx * 0.62, cz = gz * 0.62 - 0.7, dist = Math.hypot(gx, gz * 1.1);
        for (const [ox, oz] of [[-0.13, -0.13], [0.13, 0.13], [0.13, -0.13], [-0.13, 0.13]]) { if (Math.random() < 0.25) continue;
          const h = Math.max(0.15, (2.6 - dist * 0.5) * (0.45 + Math.random() * 0.6)), w = 0.16 + Math.random() * 0.06;
          const m = new T.Mesh(new T.BoxGeometry(w, h, w), winM); m.position.set(cx + ox, h / 2, cz + oz); m.castShadow = true; m.receiveShadow = true; city.add(m);
          if (h > 1.1) { const cap = new T.Mesh(new T.BoxGeometry(w * 0.6, 0.05, w * 0.6), M.gold); cap.position.set(cx + ox, h + 0.025, cz + oz); city.add(cap); } }
      }
      for (const [w, d, x, z] of [[4.4, 0.06, 0, -0.7], [0.06, 3.8, 0, -0.7]]) { const av = new T.Mesh(new T.BoxGeometry(w, 0.01, d), M.neonRed); av.position.set(x, 0.01, z); city.add(av); }
      const spire = new T.Mesh(new T.CylinderGeometry(0.035, 0.2, 3.2, 8), M.obsidian); spire.position.set(0, 1.6, -0.7); city.add(spire);
      const eye = new T.Mesh(new T.SphereGeometry(0.16, 24, 16), M.neonRed); eye.position.set(0, 3.27, -0.7); city.add(eye);
      S.onFrame((dt, t) => { eye.material.emissiveIntensity = 2 + Math.sin(t * 2.4) * 0.8; });
      // paquet Signal
      const backTex = await G3.loadTex(T, IMG + "card_signal_back.webp");
      const deckM = new T.MeshStandardMaterial({ map: backTex, roughness: 0.4 }), deck = new T.Group();
      for (let k = 0; k < 7; k++) { const m = new T.Mesh(new T.BoxGeometry(1.05, 0.02, 1.5), [M.graphite, M.graphite, deckM, M.graphite, M.graphite, M.graphite]); m.position.set(-2.5, 0.02 + k * 0.022, 2.1); m.rotation.y = 0.25 + (Math.random() - 0.5) * 0.04; m.castShadow = true; deck.add(m); }
      S.add(deck);
      // ---------------------------------------------------------------- pions
      const pawnGeo = new T.LatheGeometry([[0, 0], [0.3, 0], [0.31, 0.06], [0.23, 0.1], [0.14, 0.18], [0.1, 0.44], [0.16, 0.48], [0.11, 0.53], [0.15, 0.63], [0.15, 0.74], [0.09, 0.83], [0, 0.85]].map(([x, y]) => new T.Vector2(x, y)), 40);
      const pawns = P.map((p, i) => { const m = new T.Mesh(pawnGeo, new T.MeshPhysicalMaterial({ color: PCOL[i], roughness: 0.15, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, emissive: PCOL[i], emissiveIntensity: 0.12 }));
        m.castShadow = true; const ring = new T.Mesh(new T.TorusGeometry(0.31, 0.025, 8, 40), new T.MeshBasicMaterial({ color: PCOL[i], toneMapped: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.01; m.add(ring); S.add(m); return m; });
      const pawnSpot = (i, sq) => { const ti = tileInfo(sq), side = new T.Vector3(Math.cos(ti.rot), 0, -Math.sin(ti.rot)), along = new T.Vector3(Math.sin(ti.rot), 0, Math.cos(ti.rot));
        const off = side.multiplyScalar((i % 3 - 1) * 0.36).add(along.multiplyScalar((Math.floor(i / 3) - 0.5) * 0.42 + 0.3)); return new T.Vector3(ti.x + off.x, 0.15, ti.z + off.z); };
      const placePawns = () => pawns.forEach((m, i) => { m.visible = !st.out[i]; m.position.copy(pawnSpot(i, st.pos[i])); });
      // ---------------------------------------------------------------- dés
      const pipTex = (v) => G3.canvasTex(T, 128, 128, (g, w) => { g.fillStyle = "#0d0e12"; g.fillRect(0, 0, w, w); rr(g, 6, 6, w - 12, w - 12, 18); g.strokeStyle = "rgba(232,181,74,.6)"; g.lineWidth = 3; g.stroke();
        const P2 = { 1: [[0.5, 0.5]], 2: [[0.28, 0.28], [0.72, 0.72]], 3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]], 4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]], 5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]], 6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]] }[v];
        for (const [x, y] of P2) { const gr = g.createRadialGradient(x * w, y * w, 0, x * w, y * w, 13); gr.addColorStop(0, "#ff7a95"); gr.addColorStop(0.5, "#ef1748"); gr.addColorStop(1, "rgba(239,23,72,0)"); g.fillStyle = gr; g.beginPath(); g.arc(x * w, y * w, 13, 0, Math.PI * 2); g.fill(); } });
      const FACE = [3, 4, 1, 6, 2, 5];
      const dieMats = FACE.map((v) => new T.MeshPhysicalMaterial({ map: pipTex(v), roughness: 0.25, clearcoat: 1, emissive: 0xffffff, emissiveMap: pipTex(v), emissiveIntensity: 0.25 }));
      const dice = [0, 1].map(() => { const m = new T.Mesh(new T.BoxGeometry(0.6, 0.6, 0.6), dieMats); m.castShadow = true; m.position.set(0, -5, 0); S.add(m); return m; });
      const faceQ = (v) => { const e = { 1: [0, 0, 0], 6: [Math.PI, 0, 0], 2: [-Math.PI / 2, 0, 0], 5: [Math.PI / 2, 0, 0], 3: [0, 0, Math.PI / 2], 4: [0, 0, -Math.PI / 2] }[v]; return new T.Quaternion().setFromEuler(new T.Euler(e[0], e[1], e[2])); };
      const rollDice = async (vals, p) => {
        api.sfx("dice.throw");
        const near = pawnSpot(p, st.pos[p]).multiplyScalar(0.55);                                          // les dés roulent près du joueur (visibles en suivi)
        await Promise.all(dice.map((m, k) => { const to = new T.Vector3(near.x + (k ? 0.45 : -0.45), 0.3, near.z), from = new T.Vector3(to.x + (Math.random() - 0.5) * 2, 2.6, to.z + 1.8);
          const qEnd = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), cam.az + (Math.random() - 0.5) * 0.8).multiply(faceQ(vals[k])), spin = new T.Vector3(Math.random() * 14 + 8, Math.random() * 10, Math.random() * 14 + 6);
          return G3.tween(0.75 + k * 0.08, (t) => { m.position.lerpVectors(from, to, t); m.position.y = to.y + Math.abs(Math.cos(t * Math.PI * 2.2)) * (1 - t) * 1.6;
            if (t < 0.82) m.rotation.set(spin.x * (1 - t), spin.y * (1 - t), spin.z * (1 - t)); else m.quaternion.slerp(qEnd, (t - 0.82) / 0.18 + 0.05); }).then(() => m.quaternion.copy(qEnd)); }));
        api.vibrate(8);
      };
      // ---------------------------------------------------------------- caméra : suivi, pincer, glisser
      const sideAz = [-Math.PI / 2, Math.PI, Math.PI / 2, 0];
      const focus = (sq, zoom) => { if (!cam.follow || cam.user > 0) return; const ti = tileInfo(sq), s = Math.floor(sq / 8); const az = sideAz[s]; void ti;
        cam.azT = az; const t2 = tileInfo(sq); cam.txT = t2.x * 0.72; cam.tzT = t2.z * 0.72; cam.zoomT = zoom || 0.56; };
      const overview = () => { cam.azT = 0; cam.txT = 0; cam.tzT = 0; cam.zoomT = 1; };
      const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
      S.onFrame((dt) => { const k = Math.min(1, dt * 3.2); cam.az += angDiff(cam.az, cam.azT) * k; cam.tx += (cam.txT - cam.tx) * k; cam.tz += (cam.tzT - cam.tz) * k; cam.zoom += (cam.zoomT - cam.zoom) * k; if (cam.user > 0) cam.user -= dt; placeCam(S.camera); });
      const cv = S.renderer.domElement, touches = new Map(); let pinch0 = 0, zoom0 = 1, drag = null, moved = 0;
      cv.addEventListener("pointerdown", (e) => { touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = cam.zoomT; } else drag = { x: e.clientX, y: e.clientY, tx: cam.txT, tz: cam.tzT }; });
      cv.addEventListener("pointermove", (e) => { if (!touches.has(e.pointerId)) return; touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) { const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0 > 0) { cam.zoomT = Math.max(0.38, Math.min(1.1, zoom0 * pinch0 / d)); cam.user = 6; moved = 99; } }
        else if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved = Math.max(moved, Math.hypot(dx, dy)); if (moved > 8) { const k = (cam.base * cam.zoomT) / (cv.clientHeight || 600) * 1.1, c = Math.cos(cam.az), s = Math.sin(cam.az);
          cam.txT = Math.max(-HALF, Math.min(HALF, drag.tx - (dx * c + dy * s) * k)); cam.tzT = Math.max(-HALF, Math.min(HALF, drag.tz - (-dx * s + dy * c) * k)); cam.user = 6; } } });
      const up = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch0 = 0; if (!touches.size) drag = null; };
      cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
      cv.addEventListener("wheel", (e) => { cam.zoomT = Math.max(0.38, Math.min(1.1, cam.zoomT * (e.deltaY > 0 ? 1.1 : 0.9))); cam.user = 6; e.preventDefault(); }, { passive: false });
      // ---------------------------------------------------------------- bâtiments et propriétaires
      const antennaGeo = new T.CylinderGeometry(0.04, 0.08, 0.5, 10), lightGeo = new T.SphereGeometry(0.06, 12, 8), towerGeo = G3.roundedBox(T, 0.42, 0.95, 0.42, 0.05, 2);
      const spriteTex = {};
      const monument = (sq) => { const b = N.BOARD[sq], k = slug(b.name), im = lotArt[k]; if (!im) return null;
        if (!spriteTex[k]) { const t = new T.Texture(im); t.colorSpace = T.SRGBColorSpace; t.needsUpdate = true; spriteTex[k] = new T.SpriteMaterial({ map: t, transparent: true, depthWrite: false }); }
        const sp = new T.Sprite(spriteTex[k]); sp.scale.set(1.35, 1.35, 1); sp.center.set(0.5, 0.12); return sp; };
      const refreshDeco = () => tileGroups.forEach((g, i) => {
        const d = g.userData.deco; d.clear(); const ow = st.own[i]; if (!ow) return; const ti = tileInfo(i), w = ti.corner ? C : W1;
        if (N.BOARD[i].type === "lot" && !ow.mort) { const sp = monument(i); if (sp) { sp.position.set(0, 0.16, 0.05); d.add(sp); if (!g.userData.rose) { g.userData.rose = true; sp.scale.set(0.01, 0.01, 1); G3.tween(0.6, (k) => sp.scale.set(1.35 * k, 1.35 * k, 1), (k) => 1 - Math.pow(1 - k, 3) * Math.cos(k * 5) * (1 - k)); } } }
        const strip = new T.Mesh(new T.BoxGeometry(w * 0.86, 0.05, 0.13), new T.MeshBasicMaterial({ color: PCOL[ow.p], toneMapped: false, transparent: true, opacity: ow.mort ? 0.3 : 1 })); strip.position.set(0, 0.16, C / 2 - 0.13); d.add(strip);
        if (ow.mort) { const x = new T.Mesh(new T.BoxGeometry(w * 0.7, 0.01, 0.06), new T.MeshBasicMaterial({ color: 0x888888 })); x.position.set(0, 0.16, 0); x.rotation.y = 0.9; d.add(x); }
        if (ow.lvl === 4) { const t = new T.Mesh(towerGeo, winM); t.position.set(0, 0.62, -C / 2 + 0.45); t.castShadow = true; d.add(t); const cap = new T.Mesh(new T.ConeGeometry(0.24, 0.26, 4), M.gold); cap.position.set(0, 1.22, -C / 2 + 0.45); cap.rotation.y = Math.PI / 4; d.add(cap); }
        else for (let k = 0; k < (ow.lvl || 0); k++) { const a = new T.Mesh(antennaGeo, M.obsidian), x = (k - ((ow.lvl || 0) - 1) / 2) * 0.32; a.position.set(x, 0.4, -C / 2 + 0.42); a.castShadow = true; d.add(a); const l = new T.Mesh(lightGeo, M.neonRed); l.position.set(x, 0.68, -C / 2 + 0.42); d.add(l); }
      });
      // ---------------------------------------------------------------- HUD
      // ---------------------------------------------------------------- illustrations (images de ChatGPT si présentes, sinon skyline de nuit générée)
      const illCache = {};
      const ill = (sq) => { const b = N.BOARD[sq]; if (b.type === "lot" && (art.lots || []).includes(slug(b.name))) return IMG + "lots/" + slug(b.name) + ".webp"; if (b.type === "relay" && (art.icons || []).includes("airport")) return IMG + "icons/airport.webp";
        if (illCache[sq]) return illCache[sq];
        const col = b.type === "lot" ? N.DIST[b.d].color : "#e8b54a", cv = document.createElement("canvas"); cv.width = 480; cv.height = 360; const g = cv.getContext("2d");
        let seed = [...b.name].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
        const sky = g.createLinearGradient(0, 0, 0, 360); sky.addColorStop(0, "#05060c"); sky.addColorStop(0.65, "#140812"); sky.addColorStop(1, "#05060a"); g.fillStyle = sky; g.fillRect(0, 0, 480, 360);
        const glow = g.createRadialGradient(240, 250, 10, 240, 250, 260); glow.addColorStop(0, col + "88"); glow.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = glow; g.fillRect(0, 0, 480, 360);
        for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.7})`; g.fillRect(rnd() * 480, rnd() * 160, 1.5, 1.5); }
        for (let layer = 0; layer < 2; layer++) { let x = -10; while (x < 490) { const w = 18 + rnd() * 46, h = (layer ? 70 : 110) + rnd() * (layer ? 120 : 170), y = 360 - h;
          g.fillStyle = layer ? "#0b0c12" : "#14151d"; g.fillRect(x, y, w, h); if (rnd() < 0.25) { g.fillRect(x + w / 2 - 2, y - 30, 4, 30); g.fillStyle = col; g.fillRect(x + w / 2 - 3, y - 34, 6, 6); }
          for (let yy = y + 8; yy < 352; yy += 10) for (let xx = x + 4; xx < x + w - 5; xx += 8) if (rnd() < (layer ? 0.34 : 0.18)) { g.fillStyle = rnd() < 0.8 ? "rgba(255,210,160,.85)" : col; g.fillRect(xx, yy, 4, 5); }
          x += w + 2 + rnd() * 8; } }
        const ref = g.createLinearGradient(0, 300, 0, 360); ref.addColorStop(0, "rgba(0,0,0,0)"); ref.addColorStop(1, col + "55"); g.fillStyle = ref; g.fillRect(0, 300, 480, 60);
        return (illCache[sq] = cv.toDataURL("image/jpeg", 0.82)); };
      const regionOf = (sq) => { const b = N.BOARD[sq]; return b.type === "lot" ? N.DIST[b.d].name : b.type === "relay" ? "Aéroport" : ""; };
      const colorOf = (sq) => { const b = N.BOARD[sq]; return b.type === "lot" ? N.DIST[b.d].color : "#e8b54a"; };
      const SVG = { dice: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="12" height="12" rx="3"/><rect x="9" y="9" width="12" height="12" rx="3"/><circle cx="7" cy="7" r="1"/><circle cx="11" cy="11" r="1"/><circle cx="13" cy="13" r="1"/><circle cx="17" cy="17" r="1"/></svg>',
        layers: '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>', gavel: '<svg viewBox="0 0 24 24"><path d="M14 4l6 6M11 7l6 6M12.5 5.5l-4 4M17.5 10.5l-4 4M10.5 11.5L4 18"/><path d="M3 21h9"/></svg>',
        swap: '<svg viewBox="0 0 24 24"><path d="M4 8h14l-3-3M20 16H6l3 3"/></svg>', wallet: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 12h2M3 9h15V6"/></svg>',
        user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>', star: '<svg viewBox="0 0 24 24"><rect x="2.5" y="2.5" width="19" height="19" rx="3"/><path d="M12 6.5l1.6 3.9 4.1.3-3.2 2.6 1 4-3.5-2.2-3.5 2.2 1-4-3.2-2.6 4.1-.3z"/></svg>', x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' };
      const ICON = (k, fallback) => ((art.icons || []).includes(k) ? `<img class="nc-ico" src="${IMG}icons/${k}.webp" alt="">` : SVG[fallback || k] || "");
      // ---------------------------------------------------------------- HUD : barre du haut, joueurs, panneau du bas
      api.stage.classList.add("nc-on"); const tbar = api.stage.querySelector(".gm-top b"); if (tbar) tbar.outerHTML = `<div class="nc-brand"><span class="nc-logo">${ICON("logo", "star")}</span><b>NÉO-CITÉ</b><i></i><em id="nc-round"></em></div>`;
      const top = document.createElement("div"); top.className = "nc-players"; api.stage.appendChild(top);
      const land = document.createElement("div"); land.className = "nc-land"; land.hidden = true; api.stage.appendChild(land);
      const viewBtn = document.createElement("button"); viewBtn.className = "nc-view"; api.stage.appendChild(viewBtn);
      const paintView = () => { viewBtn.textContent = cam.follow ? "Vue plateau" : "Suivre"; };
      viewBtn.onclick = () => { cam.follow = !cam.follow; cam.user = 0; if (cam.follow) focus(st.pos[st.turn]); else overview(); paintView(); }; paintView();
      api.hud.innerHTML = `<div class="nc-log" id="nc-log"></div><div class="nc-deed" id="nc-deed" hidden></div><div class="nc-panel"><div class="nc-panel-h"><span>Réserve <b id="nc-res"></b></span><span id="nc-me"></span></div><div class="nc-acts" id="nc-acts"></div></div>`;
      const $ = (q) => api.hud.querySelector(q);
      const AV = (i) => (P[i].img ? `<img src="${esc(P[i].img)}" alt="">` : `<span class="ph">${SVG.user}</span>`);
      const drawPlayers = () => {
        top.innerHTML = P.map((p, i) => `<div class="nc-pl${st.turn === i ? " on" : ""}${st.out[i] ? " out" : ""}${st.cash[i] < 0 ? " neg" : ""}" style="--c:${PCOL[i]}"><span class="av">${AV(i)}</span><div><b>${esc(p.name)}</b><small>${st.out[i] ? "Faillite" : fmt(st.cash[i])}</small></div>${st.jail[i] >= 0 && !st.out[i] ? '<i class="jl" title="Pare-feu">⛨</i>' : ""}${st.turn === i && !st.out[i] ? `<em>${p.human ? "À toi" : "Joue"}</em>` : ""}</div>`).join("");
        const r = api.stage.querySelector("#nc-round"); if (r) r.innerHTML = `TOUR <b>${st.round}</b>${st.maxRounds ? " / " + st.maxRounds : ""}`;
        const rs = $("#nc-res"); if (rs) rs.textContent = fmt(st.reserve);
        const me = $("#nc-me"), h = P.findIndex((x) => x.human); if (me && h >= 0) me.innerHTML = `${SVG.wallet}<b class="${st.cash[h] < 0 ? "neg" : ""}">${fmt(st.cash[h])}</b>`; };
      const showLand = (sq) => { const b = N.BOARD[sq], ow = st.own[sq], col = colorOf(sq);
        land.innerHTML = `<span style="--c:${col}"></span><div><small>${b.type === "lot" ? esc(N.DIST[b.d].name) : b.type === "relay" ? "Aéroport" : "Case"}</small><b>${esc(b.name)}</b></div>${ow ? `<em style="--c:${PCOL[ow.p]}">${esc(name(ow.p))}</em>` : b.price ? `<em>${fmt(b.price)}</em>` : ""}`;
        land.hidden = false; land.classList.remove("in"); void land.offsetWidth; land.classList.add("in"); highlight(sq, col); };
      const say = (txt) => { $("#nc-log").textContent = txt; };
      const name = (i) => P[i].name;
      const isMine = () => P[st.turn] && P[st.turn].human && !st.out[st.turn];
      const rentRows = (b) => { const r0 = b.rent[0]; return [["1 ville", r0], ["2 villes de la région", Math.round(r0 * N.SETMULT[1])], ["Région complète", Math.round(r0 * N.SETMULT[2])], ["1 antenne", b.rent[1]], ["2 antennes", b.rent[2]], ["3 antennes", b.rent[3]], ["Tour", b.rent[4]]]; };
      /** en-tête illustré d'une ville (fiche, enchères) */
      const headHTML = (sq, tag) => `<div class="nc-head" style="--c:${colorOf(sq)}"><img class="nc-ill" src="${ill(sq)}" alt=""><div><small>${esc(regionOf(sq))}</small><b>${esc(N.BOARD[sq].name)}</b>${N.BOARD[sq].type === "lot" ? `<span class="nc-lm">${esc(N.DIST[N.BOARD[sq].d].landmarks[N.BOARD[sq].k])}</span>` : ""}${tag ? `<span class="nc-tag">${tag}</span>` : ""}</div></div>`;
      const deedHTML = (sq) => { const b = N.BOARD[sq], ow = st.own[sq];
        const owner = `<p>${ow ? "Propriétaire : <b>" + esc(name(ow.p)) + "</b>" + (ow.mort ? " · hypothéqué" : "") : "Prix : <b>" + fmt(b.price) + "</b>"}</p>`;
        if (b.type === "relay") return `<div class="nc-card" style="--c:#e8b54a">${headHTML(sq)}<table><tr><td>1 aéroport</td><td>40 €</td></tr><tr><td>2 aéroports</td><td>100 €</td></tr><tr><td>Vol vers l'autre aéroport</td><td>50 €</td></tr></table>${owner}</div>`;
        if (b.type !== "lot") return `<div class="nc-card"><b>${esc(b.name)}</b></div>`;
        const cnt = ow ? N.lotsOf(b.d).filter((i) => N.owner(st, i) === ow.p).length : 0, cur = ow ? (ow.lvl ? 2 + ow.lvl : cnt - 1) : -1;
        return `<div class="nc-card" style="--c:${N.DIST[b.d].color}">${headHTML(sq)}<table>${rentRows(b).map(([l, v], k) => `<tr class="${k === cur ? "on" : ""}"><td>${l}</td><td>${fmt(v)}</td></tr>`).join("")}</table>
          <p>Antenne ou tour : ${fmt(b.build)} · Hypothèque : ${fmt(b.price / 2)}</p>${owner}</div>`; };
      const renderActs = () => {
        drawPlayers(); const box = $("#nc-acts"), deed = $("#nc-deed"); deed.hidden = true;
        if (busy || st.over || !isMine()) { box.innerHTML = `<div class="nc-wait">${st.over ? "" : esc(P[st.turn] ? name(st.turn) + " joue…" : "")}</div>`; return; }
        const p = st.turn, ph = st.phase, B = (a, l, cls, dis, ic) => `<button class="btn${cls ? " " + cls : ""}" data-a="${a}"${dis ? " disabled" : ""}>${ic ? `<span class="bi">${ic}</span>` : ""}<span>${l}</span></button>`;
        let h = "";
        if (ph === "jailed") h = B("roll", "Tenter un double", "pri", false, ICON("dice")) + B("jpay", "Payer 50 €", "", !N.canSpend(st, p, N.JAIL_FEE)) + (st.passes[p] ? B("jpass", "Laissez-passer") : "");
        else if (ph === "roll") h = B("roll", "Lancer les dés", "pri big", false, ICON("dice")) + B("manage", "Gérer", "", false, SVG.layers);
        else if (ph === "buy") { const b = N.BOARD[st.pending]; deed.hidden = false; deed.innerHTML = deedHTML(st.pending); h = B("buy", "Acheter " + fmt(b.price), "pri", !N.canSpend(st, p, b.price)) + B("pass", "Refuser"); }
        else if (ph === "relay") h = B("relay1", "Vol · 50 €", "pri", !N.canSpend(st, p, 50)) + B("relay0", "Rester");
        else if (ph === "end") h = B("end", "Fin du tour", "pri big") + B("manage", "Gérer", "", false, SVG.layers);
        box.innerHTML = h;
        api.turn(setup.mode === "local" && P.filter((x) => x.human).length > 1 ? name(p) : "À toi", 0);
      };
      // fenêtres (maquette) : apparition animée, fermeture en fondu
      const modal = (cls, html) => { const m = document.createElement("div"); m.className = "nc-modal " + cls; m.innerHTML = `<div class="nc-mod">${html}</div>`; api.stage.appendChild(m); requestAnimationFrame(() => m.classList.add("in")); return m; };
      const closeModal = (m) => { if (!m || !m.isConnected) return; m.classList.remove("in"); m.classList.add("out"); setTimeout(() => m.remove(), 260); };
      // ---------------------------------------------------------------- animations d'événements
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const hop = (i, from, to) => { const m = pawns[i], a = m.position.clone(), b = pawnSpot(i, to); return G3.tween(0.17, (t) => { m.position.lerpVectors(a, b, t); m.position.y = 0.15 + Math.sin(t * Math.PI) * 0.45; }); };
      const movePawn = async (i, from, to, direct) => {
        focus(to);
        if (direct) { const m = pawns[i], a = m.position.clone(), b = pawnSpot(i, to); await G3.tween(0.7, (t) => { m.position.lerpVectors(a, b, t); m.position.y = 0.15 + Math.sin(t * Math.PI) * 2.4; }); return; }
        const fwd = (to - from + N.SIZE) % N.SIZE, back = (from - to + N.SIZE) % N.SIZE, dir = fwd <= 12 || back > 6 ? 1 : -1, steps = dir > 0 ? fwd : back;
        if (steps > 14) return movePawn(i, from, to, true);
        let cur = from; for (let k = 0; k < steps; k++) { const nx = (cur + dir + N.SIZE) % N.SIZE; focus(nx); await hop(i, cur, nx); cur = nx; api.sfx("nc.hop", { intensity: 0.6 }); }
      };
      const floatText = (sq, txt, col) => { const ti = tileInfo(sq), v = new T.Vector3(ti.x, 0.6, ti.z).project(S.camera), rc = S.renderer.domElement.getBoundingClientRect();
        const el = document.createElement("div"); el.className = "nc-float"; el.style.cssText = `left:${((v.x + 1) / 2) * rc.width}px;top:${((1 - v.y) / 2) * rc.height}px;color:${col || "#e8b54a"}`; el.textContent = txt; api.stage.appendChild(el); setTimeout(() => el.remove(), 1500); };
      const showCard = (e) => new Promise((res) => { const ca = (art.cards || []).includes(e.card);
        const m = modal("nc-sig", `<div class="nc-tabic">${ICON("signal", "star")}</div><h2>Signal</h2><p class="nc-sub">Événement</p>${ca ? `<img class="nc-cardimg" src="${IMG}cards/${e.card}.webp" alt="">` : `<div class="nc-sigorb"></div>`}<p class="nc-sigtxt">${esc(e.text)}</p><button class="btn pri wide" data-ok>Continuer</button>`);
        api.sfx("nc.card"); const done = () => { clearTimeout(tm); closeModal(m); res(); }; const tm = setTimeout(done, P[st.turn] && P[st.turn].human ? 4000 : 2200); m.querySelector("[data-ok]").onclick = done; });
      const run = async (ev) => {
        for (const e of ev) {
          if (e.t === "dice") { await rollDice(e.dice, e.p); say(`${name(e.p)} fait ${e.dice[0]} + ${e.dice[1]}${e.dice[0] === e.dice[1] ? " · double" : ""}`); await wait(150); }
          else if (e.t === "move") { await movePawn(e.p, e.from, e.to, Math.abs(e.to - e.from) > 12 && (e.to === N.RELAYS[0] || e.to === N.RELAYS[1]) && N.BOARD[e.from].type === "relay"); showLand(e.to); }
          else if (e.t === "salary") { floatText(0, "+200 €", "#22c55e"); }
          else if (e.t === "rent") { say(`${name(e.p)} paie ${fmt(e.amount)} de loyer à ${name(e.to)}`); floatText(e.sq, "−" + fmt(e.amount), "#ff3d63"); api.sfx("nc.pay"); await wait(600); }
          else if (e.t === "card") { await showCard(e); }
          else if (e.t === "jail") { say(`${name(e.p)} part au Pare-feu`); api.sfx("nc.jail"); await movePawn(e.p, st.pos[e.p], N.JAIL, true); showLand(N.JAIL); api.vibrate(20); }
          else if (e.t === "free") say(`${name(e.p)} sort du Pare-feu${e.paid ? " (50 €)" : ""}`);
          else if (e.t === "reserve") { say(`${name(e.p)} remporte la Réserve : ${fmt(e.amount)}`); floatText(N.RESERVE, "+" + fmt(e.amount), "#22c55e"); api.sfx("nc.reserve"); await wait(500); }
          else if (e.t === "auction") { say(`Enchères : ${N.BOARD[e.sq].name}`); api.sfx("nc.auction"); }
          else if (e.t === "mort") say(`${name(e.p)} hypothèque ${N.BOARD[e.sq].name}`);
          else if (e.t === "sell") say(`${name(e.p)} vend un bâtiment`);
          else if (e.t === "bankrupt") { say(`${name(e.p)} fait faillite`); api.toast(`${name(e.p)} fait faillite`, "warn"); api.sfx("nc.bankrupt"); pawns[e.p].visible = false; await wait(700); }
          refreshDeco(); drawPlayers();
        }
        refreshDeco(); drawPlayers();
      };
      // ---------------------------------------------------------------- case Enchères (tout le monde enchérit, sous pli fermé)
      const botCeil = (j, sq) => { const lvl = P[j].level || setup.level || "normal", f = { easy: 0.75, normal: 0.95, hard: 1.05, max: 1.12 }[lvl] || 0.95;
        return Math.max(0, Math.min(Math.floor((N.value(st, j, sq) * f * (0.9 + Math.random() * 0.2)) / 5) * 5, st.cash[j] - 60)); };
      /** enchères montantes : chacun à son tour surenchérit ou passe ; le dernier en lice paie sa mise */
      const auction = async () => {
        const sq = st.pending, b = N.BOARD[sq]; focus(sq, 0.7); api.sfx("nc.auction");
        const active = P.map((_, j) => j).filter((j) => !st.out[j]), ceil = {}, hist = []; let cur = 0, lead = -1, idx = 0, guard = 0;
        active.forEach((j) => { if (!P[j].human) ceil[j] = botCeil(j, sq); });
        const m = modal("nc-auc", `<div class="nc-tabic">${ICON("gavel")}</div><button class="nc-x" data-x>${SVG.x}</button><h2>Enchères</h2><p class="nc-sub">Propriété disponible</p>${headHTML(sq, "Mise libre")}
          <div class="nc-info"><div><span>${SVG.layers}Valeur du lot</span><b>${fmt(b.price)}</b></div><div><span>${SVG.wallet}Ton solde</span><b data-solde></b></div><div><span>${SVG.gavel}Mise actuelle</span><b data-cur></b></div></div>
          <div class="nc-lbl">Ton offre</div><div class="nc-step"><button data-d="-1">−</button><b data-offer></b><button data-d="1">+</button></div>
          <div class="nc-lbl l">Historique des offres</div><div class="nc-hist" data-hist></div><p class="nc-stat" data-stat></p>
          <div class="nc-btns"><button class="btn" data-pass>Passer</button><button class="btn pri" data-bid>Placer l'offre</button></div>`);
        const me = P.findIndex((x) => x.human); let offer = 0, waiting = null;
        const step = () => (cur < 100 ? 10 : cur < 400 ? 20 : 50);
        const paint = (stat) => { m.querySelector("[data-solde]").textContent = me >= 0 ? fmt(st.cash[me]) : "—"; m.querySelector("[data-cur]").textContent = cur ? fmt(cur) + (lead >= 0 ? " · " + name(lead) : "") : "—";
          m.querySelector("[data-offer]").textContent = fmt(offer); m.querySelector("[data-hist]").innerHTML = hist.slice(-4).map(([j, v], k, arr) => `<span class="${k === arr.length - 1 ? "on" : ""}" style="--c:${PCOL[j]}"><small>${esc(name(j))}</small>${fmt(v)}</span>`).join("") || `<em>Aucune offre pour l'instant</em>`;
          if (stat != null) m.querySelector("[data-stat]").textContent = stat; const mine = waiting != null; m.querySelectorAll("[data-pass],[data-bid],[data-d]").forEach((x) => (x.disabled = !mine)); };
        const humanTurn = (j) => new Promise((res) => { offer = Math.min(Math.max(0, st.cash[j]), cur + step()); if (offer <= cur) return res(0); waiting = j; paint(P.filter((x) => x.human).length > 1 ? `${name(j)}, à toi d'enchérir` : "À toi d'enchérir");
          m.querySelectorAll("[data-d]").forEach((x) => (x.onclick = () => { offer = Math.max(cur + step(), Math.min(Math.max(0, st.cash[j]), offer + +x.dataset.d * step())); paint(); }));
          m.querySelector("[data-bid]").onclick = () => { waiting = null; res(offer); }; m.querySelector("[data-pass]").onclick = m.querySelector("[data-x]").onclick = () => { waiting = null; res(0); }; });
        paint("Les enchères commencent");
        while (active.length && guard++ < 300) {
          if (active.length === 1 && lead === active[0]) break;
          const j = active[idx % active.length]; if (j === lead) { idx++; continue; }
          let bid = 0;
          if (P[j].human) bid = await humanTurn(j);
          else { paint(`${name(j)} réfléchit…`); await wait(420 + Math.random() * 300); if (!alive) return; const nb = cur + step() * (Math.random() < 0.3 ? 2 : 1); bid = nb <= ceil[j] ? nb : cur + step() <= ceil[j] ? cur + step() : 0; }
          if (bid > cur && bid <= Math.max(0, st.cash[j])) { cur = bid; lead = j; hist.push([j, bid]); api.sfx("chip.lay"); paint(`${name(j)} offre ${fmt(bid)}`); idx++; }
          else { active.splice(active.indexOf(j), 1); paint(`${name(j)} passe`); if (!active.length) break; }
        }
        const bids = P.map((_, j) => (j === lead ? cur : 0)), w = N.auction(st, bids);
        paint(w >= 0 ? `Adjugé à ${name(w)} pour ${fmt(cur)}` : "Personne ne remporte la ville"); m.classList.add("done"); await wait(1100); closeModal(m);
        say(w >= 0 ? `${name(w)} remporte ${b.name} pour ${fmt(cur)}` : `Personne ne prend ${b.name}`);
        if (w >= 0) { floatText(sq, fmt(cur), PCOL[w]); api.sfx("nc.buy", { delay: 0.1 }); highlight(sq, PCOL[w]); }
        refreshDeco(); drawPlayers(); await wait(400);
      };
      const lotCard = (sq, on, attr) => `<button class="nc-lot${on ? " on" : ""}" ${attr} style="--c:${colorOf(sq)}"><img src="${ill(sq)}" alt=""><span>${esc(N.BOARD[sq].name)}</span></button>`;
      const tradeEditor = (from) => new Promise((res) => {
        const others = P.map((p, i) => i).filter((i) => i !== from && !st.out[i]); let to = others[0], give = new Set(), get = new Set(), cash = 0;
        const m = modal("nc-trd", `<div class="nc-tabic">${ICON("trade", "swap")}</div><button class="nc-x" data-x>${SVG.x}</button><h2>Proposer un échange</h2><p class="nc-sub">Négocie avec un adversaire</p><div data-body></div>
          <div class="nc-btns col"><button class="btn pri wide" data-send>Proposer l'échange</button><button class="btn wide" data-x2>Annuler</button></div>`);
        const draw = () => { const mine = Object.keys(st.own).map(Number).filter((i) => N.tradable(st, from, i)), theirs = Object.keys(st.own).map(Number).filter((i) => N.tradable(st, to, i));
          m.querySelector("[data-body]").innerHTML = `<div class="nc-who">${others.map((i) => `<button data-to="${i}" class="${i === to ? "on" : ""}" style="--c:${PCOL[i]}"><span class="av">${AV(i)}</span>${esc(name(i))}</button>`).join("")}</div>
            <section class="nc-sec ask"><header><b>Tu demandes</b><small>Tu recevras de ${esc(name(to))}</small></header><div class="nc-lots">${theirs.length ? theirs.map((sq) => lotCard(sq, get.has(sq), `data-get="${sq}"`)).join("") : `<p class="muted">Aucune ville échangeable.</p>`}</div></section>
            <div class="nc-swapsep">${SVG.swap}</div>
            <section class="nc-sec give"><header><b>Tu offres</b><small>Tu donnes à ${esc(name(to))}</small></header><div class="nc-lots">${mine.map((sq) => lotCard(sq, give.has(sq), `data-give="${sq}"`)).join("")}
              <div class="nc-money"><div>${ICON("coins", "wallet")}<b>${cash >= 0 ? fmt(cash) : "Tu reçois " + fmt(-cash)}</b></div><div class="nc-cash"><button data-c="-100">−100</button><button data-c="-10">−10</button><button data-c="10">+10</button><button data-c="100">+100</button></div></div></div></section>`;
          m.querySelectorAll("[data-to]").forEach((b) => (b.onclick = () => { to = +b.dataset.to; get = new Set(); draw(); }));
          m.querySelectorAll("[data-get]").forEach((b) => (b.onclick = () => { const k = +b.dataset.get; get.has(k) ? get.delete(k) : get.add(k); draw(); }));
          m.querySelectorAll("[data-give]").forEach((b) => (b.onclick = () => { const k = +b.dataset.give; give.has(k) ? give.delete(k) : give.add(k); draw(); }));
          m.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { cash += +b.dataset.c; draw(); })); };
        draw();
        const quit = () => { closeModal(m); res(null); }; m.querySelector("[data-x]").onclick = quit; m.querySelector("[data-x2]").onclick = quit;
        m.querySelector("[data-send]").onclick = () => { const o = { from, to, give: [...give], get: [...get], cash }; if (!N.tradeValid(st, o)) { api.toast("Offre incomplète ou impossible.", "warn"); return; } closeModal(m); res(o); }; });
      /** la cible répond : bot (évaluation) ou humain (fenêtre Accepter / Refuser) */
      const answer = (o) => new Promise((res) => {
        if (!P[o.to].human) return res(N.botAccepts(st, o, P[o.to].level || "normal"));
        const side = (lots, money, title, sub) => `<section class="nc-sec"><header><b>${title}</b><small>${sub}</small></header><div class="nc-lots">${lots.map((sq) => lotCard(sq, true, "disabled")).join("")}${money > 0 ? `<div class="nc-money"><div>${ICON("coins", "wallet")}<b>${fmt(money)}</b></div></div>` : ""}${!lots.length && !(money > 0) ? `<p class="muted">Rien</p>` : ""}</div></section>`;
        const m = modal("nc-trd", `<div class="nc-tabic">${ICON("trade", "swap")}</div><h2>${esc(name(o.from))} te propose un échange</h2><p class="nc-sub">${P.filter((p) => p.human).length > 1 ? esc(name(o.to)) : "Accepte ou refuse"}</p>
          ${side(o.give, o.cash, "Tu reçois", "de " + esc(name(o.from)))}<div class="nc-swapsep">${SVG.swap}</div>${side(o.get, -o.cash, "Tu donnes", "à " + esc(name(o.from)))}
          <div class="nc-btns"><button class="btn" data-no>Refuser</button><button class="btn pri" data-yes>Accepter</button></div>`);
        m.querySelector("[data-yes]").onclick = () => { closeModal(m); res(true); }; m.querySelector("[data-no]").onclick = () => { closeModal(m); res(false); }; });
      const doTrade = async (o) => { const ok = await answer(o);
        if (ok && N.trade(st, o)) { say(`Échange conclu : ${name(o.from)} ↔ ${name(o.to)}`); api.sfx("nc.buy"); [...o.give, ...o.get].forEach((sq) => highlight(sq, "#ffffff")); refreshDeco(); drawPlayers(); api.toast("Échange accepté", "ok"); }
        else { say(`${name(o.to)} refuse l'échange`); api.toast(`${name(o.to)} refuse`, ""); } return ok; };
      // ---------------------------------------------------------------- gestion (construire, vendre, hypothéquer, échanger)
      const manage = () => {
        const p = st.turn, mine = Object.keys(st.own).map(Number).filter((i) => st.own[i].p === p).sort((a, b) => a - b);
        const row = (i) => { const b = N.BOARD[i], ow = st.own[i], col = b.type === "lot" ? N.DIST[b.d].color : "#e8b54a", lvl = ow.lvl === 4 ? "Tour" : ow.lvl ? ow.lvl + " antenne" + (ow.lvl > 1 ? "s" : "") : "";
          const cnt = b.type === "lot" ? N.lotsOf(b.d).filter((k) => N.owner(st, k) === p).length : 0;
          const btn = (a, l, ok) => `<button data-a="${a}" data-i="${i}"${ok ? "" : " disabled"}>${l}</button>`;
          return `<div class="nc-row" style="--c:${col}"><span><b>${esc(b.name)}</b><small>${ow.mort ? "Hypothéqué" : lvl || (b.type === "lot" ? (cnt === 3 ? "Quartier complet" : cnt + "/3 du quartier") : "")} · loyer ${fmt(N.rentOf(st, i))}</small></span>
            ${b.type === "lot" && ow.lvl < 4 ? btn("build", (ow.lvl === 3 ? "Tour " : "Antenne ") + b.build, N.canBuild(st, p, i)) : ""}${ow.lvl ? btn("sell", "Vendre", N.canSell(st, p, i)) : ""}
            ${ow.mort ? btn("unmort", "Lever " + N.unmortgageCost(i), st.cash[p] >= N.unmortgageCost(i)) : btn("mort", "Hypothéquer", !ow.lvl && !(b.type === "lot" && N.lotsOf(b.d).some((k) => st.own[k] && st.own[k].lvl > 0)))}</div>`; };
        const html = `<button class="btn wide nc-tradebtn" data-a="trade">Proposer un échange</button>` + (mine.length ? `<h4 class="pl-h4">Tes lots · ${fmt(st.cash[p])}${st.cash[p] < 0 ? " (découvert)" : ""}</h4>` + mine.map(row).join("") : `<p class="muted">Tu ne possèdes encore aucun lot.</p>`);
        E.ui.sheet({ title: "Gérer", html: `<div class="nc-manage">${html}</div>`, onOpen: (s) => s.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
          const i = +b.dataset.i, a = b.dataset.a; let ok = false;
          if (a === "trade") { E.ui.closeSheet(true); busy = true; renderActs(); const o = await tradeEditor(p); if (o) await doTrade(o); busy = false; renderActs(); return; }
          if (a === "build") ok = N.build(st, p, i); else if (a === "sell") ok = N.sell(st, p, i); else if (a === "mort") ok = N.mortgage(st, p, i); else if (a === "unmort") ok = N.unmortgage(st, p, i);
          if (ok) { api.sfx(a === "build" ? "nc.build" : "nc.pay"); refreshDeco(); drawPlayers(); manage(); } })) });
      };
      // ---------------------------------------------------------------- déroulement
      let busy = false, alive = true;
      const act = async (fn) => { busy = true; renderActs(); try { await fn(); } finally { busy = false; } if (!alive) return; placePawns(); next(); };
      const finish = () => { const w = st.over.winner; overview(); api.end(w, st.over.reason === "last" ? "Tous les autres joueurs ont fait faillite." : `Plus grosse fortune après ${st.maxRounds} tours : ${fmt(N.netWorth(st, w))}.`); };
      const next = async () => {
        if (!alive) return; drawPlayers();
        if (st.over) { renderActs(); return finish(); }
        const p = st.turn;
        if (setup.mode === "bots" && st.out[P.findIndex((x) => x.human)]) { renderActs(); let w = 0; for (let j = 0; j < n; j++) if (!st.out[j] && N.netWorth(st, j) > N.netWorth(st, w)) w = j; return api.end(w, "Tu as fait faillite."); }
        if (st.phase === "auction") { busy = true; renderActs(); await auction(); busy = false; if (!alive) return; return next(); }
        if (P[p].human) { if (st.phase === "roll" || st.phase === "jailed") focus(st.pos[p]); renderActs(); return; }
        // bot
        busy = true; renderActs(); api.turn(name(p) + " joue", 1); const lvl = P[p].level || setup.level || "normal";
        if (st.phase === "roll" || st.phase === "jailed") focus(st.pos[p]);
        await wait(st.phase === "roll" || st.phase === "jailed" ? 650 : 500); if (!alive) return;
        if (st.phase === "jailed") { const d = N.botJail(st, lvl); if (d === "pass") { N.jailPass(st); say(`${name(p)} utilise un laissez-passer`); } else if (d === "pay") { N.jailPay(st); say(`${name(p)} paie 50 € pour sortir`); } else await run(N.roll(st)); }
        else if (st.phase === "roll") await run(N.roll(st));
        else if (st.phase === "buy") { const sq = st.pending; if (N.botWantsBuy(st, lvl)) { N.buy(st); say(`${name(p)} achète ${N.BOARD[sq].name}`); floatText(sq, fmt(N.BOARD[sq].price), PCOL[p]); api.sfx("nc.buy"); highlight(sq, PCOL[p]); refreshDeco(); await wait(450); } else { N.pass(st); say(`${name(p)} n'achète pas ${N.BOARD[sq].name}`); await wait(350); } }
        else if (st.phase === "relay") { const go = N.botRelay(st, lvl); if (go) say(`${name(p)} se téléporte`); await run(N.relay(st, go)); }
        else if (st.phase === "end") { const offer = N.botTradeOffer(st, p, lvl); if (offer) { say(`${name(p)} propose un échange à ${name(offer.to)}`); await doTrade(offer); await wait(400); }
          const did = N.botManage(st, p, lvl); if (did.length) { const b = did.filter((x) => x.t === "build").length; say(b ? `${name(p)} construit (${b})` : `${name(p)} lève une hypothèque`); refreshDeco(); drawPlayers(); api.sfx("nc.build"); await wait(700); } N.endTurn(st); }
        busy = false; if (!alive) return; placePawns(); next();
      };
      $("#nc-acts").addEventListener("click", (e) => {
        const b = e.target.closest("[data-a]"); if (!b || busy || !isMine()) return; const a = b.dataset.a;
        if (a === "roll") return act(async () => run(N.roll(st)));
        if (a === "jpay") { N.jailPay(st); say(`${name(st.turn)} paie 50 € pour sortir`); return next(); }
        if (a === "jpass") { N.jailPass(st); return next(); }
        if (a === "buy") { const sq = st.pending; if (N.buy(st)) { say(`${name(st.turn)} achète ${N.BOARD[sq].name}`); floatText(sq, fmt(N.BOARD[sq].price), PCOL[st.turn]); api.sfx("nc.buy"); highlight(sq, PCOL[st.turn]); refreshDeco(); } return next(); }
        if (a === "pass") { const sq = st.pending; N.pass(st); say(`${name(st.turn)} n'achète pas ${N.BOARD[sq].name}`); return next(); }
        if (a === "relay1" || a === "relay0") return act(async () => run(N.relay(st, a === "relay1")));
        if (a === "end") { N.endTurn(st); say(""); return next(); }
        if (a === "manage") return manage();
      });
      // toucher une case (sans glisser) : fiche du lot
      cv.addEventListener("click", (e) => { if (moved > 8) return; const hit = S.pick(e.clientX, e.clientY, tiles)[0]; if (!hit) return; const sq = hit.object.userData.sq, b = N.BOARD[sq]; if (b.type !== "lot" && b.type !== "relay") return; E.ui.sheet({ title: b.name, html: deedHTML(sq), options: [] }); });
      placePawns(); refreshDeco(); drawPlayers(); say("Premier joueur : " + name(0)); focus(st.pos[0]); next();
      return { destroy: () => { alive = false; S.dispose(); }, _st: () => st, _busy: () => busy, _next: () => next(), _cam: () => cam };
    },
  });
})();
