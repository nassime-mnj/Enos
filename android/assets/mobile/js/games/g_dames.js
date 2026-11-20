"use strict";
// DAMES 3D : plateau d'obsidienne cerclé d'or et de néon cramoisi, pions ivoire (Blancs) contre obsidienne (Noirs), dames couronnées.
// Toucher un pion -> cases d'arrivée éclairées ; rafles animées en sauts ; pièces prises qui s'enfoncent ; couronne dorée à la promotion.
// Local : la caméra pivote vers le joueur au trait. Contre les bots : l'IA (js/games/dames_rules.js) réfléchit dans un Worker.
(() => {
  const E = window.ENOS, G3 = E.g3d, D = E.dames;
  if (!E.jeux || !G3 || !D) return;
  const RULES = `<p><b>But</b> : prendre toutes les pièces adverses ou les bloquer.</p><p><b>Pions</b> : avancent d'une case en diagonale. <b>La prise est obligatoire</b>, en avant comme en arrière, et s'enchaîne (rafle). Si plusieurs prises sont possibles, il faut jouer celle qui prend <b>le plus de pièces</b>.</p><p><b>Dames</b> : un pion qui termine son coup sur la dernière rangée devient dame. Elle se déplace et prend à longue distance sur toute la diagonale.</p><p><b>Nulle</b> : 25 coups de chaque côté sans prise ni mouvement de pion, ou trois fois la même position.</p>`;

  E.jeux.register({
    id: "dames", title: "Dames", sub: "Règles internationales, 10×10 ou 8×8", hero: "img/games/common/hub_bg.webp", min: 2, max: 2, rules: RULES, options: [{ key: "size", label: "Plateau", def: 10, choices: [[10, "10×10 international"], [8, "8×8"]] }],
    icon: '<circle cx="8" cy="8" r="3.2"/><circle cx="16" cy="16" r="3.2"/><path d="M3 3h18v18H3z"/>',
    async start(host, setup, api) {
      const size = (setup.opts && setup.opts.size) || 10;
      let st = D.newGame(size);
      const n = st.n, P = setup.players, bot = setup.mode === "bots", humanSide = 1;     // Blancs = joueur 1 (en bas)
      // cadrage : tout le plateau (cadre compris) tient à l'écran, vue plongeante à ~58°, quel que soit le format
      const W = n + 1.8, EL = 58 * Math.PI / 180;
      const S = await G3.stage(host, { fov: 42, exposure: 0.95, fog: 0.02, cam: [0, 12, 8], look: [0, 0, 0],
        fit: (cam, ar) => { const vf = cam.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * ar);
          const dW = (W / 2) / Math.tan(hf / 2) + W * 0.12, dD = (W * Math.sin(EL) / 2) / Math.tan(vf / 2) + W * 0.35, d = Math.max(dW, dD);
          cam.userData.d = d; const sgn = cam.userData.side === -1 ? -1 : 1; cam.position.set(0, d * Math.sin(EL), sgn * d * Math.cos(EL)); cam.lookAt(0, -0.2, sgn * 0.5); } });
      const T = S.T, M = S.mats, sq = 1, half = (n * sq) / 2;
      // ---- table et plateau
      G3.backdrop(S, { y: -0.62, glow: n * 2.6 });
      const frame = new T.Mesh(G3.roundedBox(T, n + 1.4, 0.6, n + 1.4, 0.45, 5), M.obsidian); frame.position.y = -0.31; frame.castShadow = frame.receiveShadow = true; S.add(frame);
      const rim = new T.Mesh(G3.roundedBox(T, n + 0.5, 0.06, n + 0.5, 0.12, 2), M.gold); rim.position.y = 0.0; S.add(rim);
      const neon = new T.Mesh(G3.roundedBox(T, n + 1.5, 0.05, n + 1.5, 0.5, 2), M.neonRed); neon.position.y = -0.585; S.add(neon);
      const marble = G3.canvasTex(T, 512, 512, (g, w, h) => {                        // marbre crème veiné (cases claires)
        const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#cfc4b1"); gr.addColorStop(1, "#b8ad99"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
        for (let k = 0; k < 26; k++) { g.strokeStyle = `rgba(${90 + Math.random() * 40},${70 + Math.random() * 30},${60 + Math.random() * 20},${0.06 + Math.random() * 0.12})`; g.lineWidth = 0.6 + Math.random() * 2.2; g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let j = 0; j < 8; j++) { x += (Math.random() - 0.3) * 90; y += (Math.random() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); } });
      marble.wrapS = marble.wrapT = T.RepeatWrapping;
      const darkM = new T.MeshPhysicalMaterial({ color: 0x0b0c0f, roughness: 0.14, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.8 });
      const lightM = new T.MeshPhysicalMaterial({ map: marble, color: 0xc7b391, envMapIntensity: 0.6, roughness: 0.32, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.12 });
      const tile = new T.BoxGeometry(sq * 0.995, 0.08, sq * 0.995);
      const darks = new T.InstancedMesh(tile, darkM, (n * n) / 2), lights = new T.InstancedMesh(tile, lightM, (n * n) / 2);
      const pos = (i) => [(i % n) * sq - half + sq / 2, Math.floor(i / n) * sq - half + sq / 2];       // x, z
      const m4 = new T.Matrix4(); let di = 0, li = 0;
      for (let i = 0; i < n * n; i++) { const [x, z] = pos(i); m4.makeTranslation(x, 0.04, z); if ((Math.floor(i / n) + (i % n)) % 2 === 1) darks.setMatrixAt(di++, m4); else lights.setMatrixAt(li++, m4); }
      darks.receiveShadow = lights.receiveShadow = true; S.add(darks, lights);
      // ---- pièces
      const gMan = G3.disc(T, 0.4, 0.2, 0.06, 48), gRing = new T.TorusGeometry(0.25, 0.022, 10, 48);
      const pieceMats = { 1: new T.MeshPhysicalMaterial({ color: 0xf2e9d8, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.12 }), [-1]: new T.MeshPhysicalMaterial({ color: 0x0b0c10, roughness: 0.15, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }) };
      const ringMats = { 1: M.gold, [-1]: M.neonRed };
      const crownG = (() => { const g = new T.Group(); const band = new T.Mesh(new T.CylinderGeometry(0.2, 0.22, 0.09, 28, 1, true), M.gold); band.position.y = 0.05; g.add(band);
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2, sp = new T.Mesh(new T.ConeGeometry(0.045, 0.12, 10), M.gold); sp.position.set(Math.cos(a) * 0.2, 0.14, Math.sin(a) * 0.2); g.add(sp); } return g; })();
      const pieces = new Map();                                       // case -> Group
      const makePiece = (v) => {
        const side = Math.sign(v), g = new T.Group(); g.userData.side = side;
        const add = (y) => { const d = new T.Mesh(gMan, pieceMats[side]); d.position.y = y; d.castShadow = true; d.receiveShadow = true; g.add(d); const r = new T.Mesh(gRing, ringMats[side]); r.rotation.x = Math.PI / 2; r.position.y = y + 0.205; g.add(r); };
        add(0.08); if (Math.abs(v) === 2) { add(0.29); const c = crownG.clone(); c.position.y = 0.5; g.add(c); g.userData.king = true; }
        return g;
      };
      const place = (g, i, y) => { const [x, z] = pos(i); g.position.set(x, y || 0, z); };
      const sync = () => { pieces.forEach((g) => S.scene.remove(g)); pieces.clear(); st.b.forEach((v, i) => { if (!v) return; const g = makePiece(v); place(g, i); g.userData.sq = i; S.add(g); pieces.set(i, g); }); };
      sync();
      // ---- surbrillances (cases d'arrivée, pièces jouables)
      const hlG = new T.RingGeometry(0.22, 0.34, 40), hlM = new T.MeshBasicMaterial({ color: 0x1acfd6, transparent: true, opacity: 0.9, side: T.DoubleSide, toneMapped: false });
      const selM = new T.MeshBasicMaterial({ color: 0xff3d63, transparent: true, opacity: 0.85, side: T.DoubleSide, toneMapped: false });
      let marks = [];
      const clearMarks = () => { marks.forEach((m) => S.scene.remove(m)); marks = []; };
      const mark = (i, mat, r) => { const m = new T.Mesh(r ? new T.RingGeometry(0.36, 0.46, 40) : hlG, mat); m.rotation.x = -Math.PI / 2; const [x, z] = pos(i); m.position.set(x, 0.095, z); m.userData.sq = i; S.add(m); marks.push(m); return m; };
      S.onFrame((dt, t) => { marks.forEach((m) => { m.material.opacity = 0.55 + 0.4 * Math.sin(t * 5); }); neon.material.emissiveIntensity = 2.1 + 0.4 * Math.sin(t * 1.6); });
      // ---- caméra : en local, elle passe du côté du joueur au trait
      let camSide = 1;
      const faceSide = async (side) => {
        if (bot || side === camSide) return; camSide = side; const d = S.camera.userData.d || 14, from = side === 1 ? Math.PI : 0;
        await G3.tween(0.9, (k) => { const a = from + k * Math.PI; S.camera.position.set(Math.sin(a) * d * Math.cos(EL), d * Math.sin(EL), Math.cos(a) * d * Math.cos(EL)); S.camera.lookAt(0, -0.2, 0); });
        S.camera.userData.side = side;
      };
      // ---- tour / HUD
      const who = () => (st.turn === 1 ? 0 : 1);
      const count = (side) => st.b.filter((v) => Math.sign(v) === side).length;
      const hud = () => { api.turn(P[who()].name + (bot && st.turn !== humanSide ? " réfléchit…" : " joue"), who());
        api.hud.innerHTML = `<div class="gm-score"><span class="w"><i></i>${esc(P[0].name)} · ${count(1)}</span><span class="b"><i></i>${esc(P[1].name)} · ${count(-1)}</span></div>`; };
      const esc = E.esc;
      // ---- jouer un coup avec animation
      let busy = false, sel = -1, legal = [];
      const animate = async (m) => {
        const g = pieces.get(m.from); pieces.delete(m.from);
        for (let k = 1; k < m.path.length; k++) {
          const [x0, z0] = pos(m.path[k - 1]), [x1, z1] = pos(m.path[k]), jump = m.caps.length > 0;
          await G3.tween(jump ? 0.34 : 0.26, (e) => { g.position.set(x0 + (x1 - x0) * e, jump ? Math.sin(e * Math.PI) * 0.7 : Math.sin(e * Math.PI) * 0.12, z0 + (z1 - z0) * e); });
          if (jump) { api.vibrate(12); api.sound("capture"); }
        }
        m.caps.forEach((c) => { const v = pieces.get(c); if (!v) return; pieces.delete(c); G3.tween(0.5, (e) => { v.position.y = -e * 0.5; v.scale.setScalar(1 - e * 0.6); }).then(() => S.scene.remove(v)); });
        if (!m.caps.length) api.sound("move");
      };
      const commit = async (m) => {
        busy = true; clearMarks(); sel = -1;
        const before = st; await animate(m); st = D.play(st, m);
        if (Math.abs(before.b[m.from]) === 1 && Math.abs(st.b[m.to]) === 2) { api.vibrate([10, 30, 10]); api.sound("brilliant"); }
        await new Promise((r) => setTimeout(r, 120)); sync(); hud();
        if (st.over) { busy = false; return api.end(st.over.winner === 0 ? null : st.over.winner === 1 ? 0 : 1, st.over.winner === 0 ? "Partie nulle : " + st.over.why + "." : ""); }
        if (!bot) await faceSide(st.turn);
        busy = false; next();
      };
      const showLegal = () => {
        clearMarks(); legal = D.moves(st); const from = new Set(legal.map((m) => m.from));
        if (legal[0] && legal[0].caps.length) from.forEach((i) => mark(i, selM, true));             // prise obligatoire : pièces concernées en rouge
      };
      const next = async () => {
        hud();
        if (bot && st.turn !== humanSide) {
          busy = true; const t0 = Date.now();
          const m = await D.think(st, { level: setup.players[1].level || "normal" });
          await new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - t0))));
          if (!alive) return; const real = D.moves(st).find((x) => x.from === m.from && x.to === m.to && x.caps.join() === m.caps.join()) || D.moves(st)[0];
          busy = false; return commit(real);
        }
        showLegal();
      };
      // ---- toucher
      const tap = (e) => {
        if (busy || st.over) return; const p = e.changedTouches ? e.changedTouches[0] : e;
        const hit = S.ground(p.clientX, p.clientY, 0.1); if (!hit) return;
        const c = Math.floor((hit.x + half) / sq), r = Math.floor((hit.z + half) / sq); if (c < 0 || c >= n || r < 0 || r >= n) return;
        const i = r * n + c;
        if (sel >= 0) { const m = legal.filter((x) => x.from === sel && x.to === i); if (m.length) return commit(m.sort((a, b) => b.caps.length - a.caps.length)[0]); }
        if (legal.some((x) => x.from === i)) {
          sel = i; showLegal(); mark(i, selM, true); legal.filter((x) => x.from === i).forEach((x) => mark(x.to, hlM)); api.vibrate(6);
          const g = pieces.get(i); if (g) G3.tween(0.18, (k) => (g.position.y = Math.sin(k * Math.PI) * 0.18));
        } else if (Math.sign(st.b[i]) === st.turn) { api.toast(legal[0] && legal[0].caps.length ? "Prise obligatoire." : "Cette pièce ne peut pas bouger.", "warn"); }
      };
      S.renderer.domElement.addEventListener("click", tap);
      let alive = true;
      hud(); next();
      return { destroy: () => { alive = false; S.dispose(); }, _st: () => st,
        _load: (b, turn) => { st = D.clone(st); st.b = b.slice(); st.turn = turn; st.hist = {}; st.over = null; sync(); next(); }, _tap: (r, c) => { const i = r * n + c, [x, z] = pos(i); const v = new T.Vector3(x, 0.1, z).project(S.camera), rc = S.renderer.domElement.getBoundingClientRect(); tap({ clientX: rc.left + (v.x + 1) / 2 * rc.width, clientY: rc.top + (1 - v.y) / 2 * rc.height }); } };
    },
  });
})();
