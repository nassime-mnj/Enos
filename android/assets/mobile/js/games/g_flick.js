"use strict";
// FLICK FOOT / FLICK HOCKEY 3D : palets à drapeaux (dôme brillant, cerclage d'or), tir à la fronde, physique réelle (js/games/flick_rules.js).
// Décors au choix (js/games/flick_decor.js + decor_more.js : Arène ETO, Stade, Océan, Automne, Sakura, Rue, Volcan, Tempête) : seul l'environnement change, jamais la physique.
// Mise en scène : travelling d'ouverture, traînées de vitesse, étincelles aux chocs, rafales de vent au tir,
// but « ressenti » : ralenti, filet qui se tend, onde de choc, éclats aux couleurs de l'équipe, secousse et halo proportionnels à la frappe, vitesse affichée.
(() => {
  const E = window.ENOS, G3 = E.g3d, F = E.flick, esc = E.esc;
  if (!E.jeux || !G3 || !F) return;
  const FLAGS = [["fr", "France"], ["br", "Brésil"], ["ar", "Argentine"], ["de", "Allemagne"], ["es", "Espagne"], ["it", "Italie"], ["pt", "Portugal"], ["gb", "Royaume-Uni"],
    ["nl", "Pays-Bas"], ["be", "Belgique"], ["ma", "Maroc"], ["dz", "Algérie"], ["sn", "Sénégal"], ["jp", "Japon"], ["us", "États-Unis"], ["mx", "Mexique"]];
  const RULES = `<p>Chacun son tour : <b>tire en arrière</b> sur un de tes palets, comme une fronde, puis relâche. Plus tu tires loin, plus le tir est fort.</p><p>Envoie la balle (ou le palet de hockey) dans le but adverse. Après un but, engagement pour l'équipe qui a encaissé. Le premier à atteindre le score fixé gagne.</p><p>Le décor ne change que l'ambiance : la physique est la même partout.</p>`;
  const TEAM = [0x45d8ff, 0xff3d63];
  const D = () => E.flickDecor;

  E.jeux.register({
    id: "flick", title: "Flick Foot", sub: "Foot et hockey de palets, vue du dessus", hero: "img/games/common/card_flick.webp", min: 2, max: 2, rules: RULES,
    icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/><path d="M12 3v6M12 15v6"/>',
    options: [{ key: "mode", label: "Terrain", def: "foot", choices: [["foot", "Football"], ["hockey", "Hockey"]] },
      { key: "decor", label: "Décor", def: "stade", choices: [["stade", "Stade"], ["sakura", "Sakura"], ["ocean", "Océan"], ["automne", "Automne"], ["rue", "Rue"], ["volcan", "Volcan"], ["tempete", "Tempête"], ["eto", "Arène ETO"]] },
      { key: "goals", label: "Buts pour gagner", def: 3, choices: [[3, "3"], [5, "5"], [7, "7"]] },
      { key: "t0", label: "Équipe 1", def: "fr", choices: FLAGS, img: (v) => "img/games/flick/flag_" + v + ".webp" }, { key: "t1", label: "Équipe 2", def: "de", choices: FLAGS, img: (v) => "img/games/flick/flag_" + v + ".webp" }],
    async start(host, setup, api) {
      const o = setup.opts || {}, P = setup.players, bot = setup.mode === "bots";
      let st = F.newGame(o.mode || "foot", o.goals || 3);
      { const tb = api.stage && api.stage.querySelector(".gm-top b"); if (tb) tb.textContent = st.mode === "hockey" ? "Flick Hockey" : "Flick Foot"; }
      const m = st.m, ice = st.mode === "hockey", flags = [o.t0 || "fr", (o.t1 && o.t1 !== o.t0) ? o.t1 : (o.t0 === "de" ? "fr" : "de")];
      const theme = D() && D().IDS.includes(o.decor) && (D().extra[o.decor] || ["eto", "ocean", "automne", "sakura"].includes(o.decor)) ? o.decor : "eto";
      const EL = 62 * Math.PI / 180, SPAN = m.L + 2.4, WID = m.W + 1.8;
      // caméra : pose de jeu calculée à chaque redimensionnement ; le travelling d'ouverture et les « coups de poing » s'y ajoutent
      const camBase = { pos: null, look: null };
      const S = await G3.stage(host, { fov: 40, exposure: 1.0, fog: 0.012, cam: [0, 14, 6], look: [0, 0, 0], bloom: { strength: { eto: 0.6, automne: 0.22, volcan: 0.45, stade: 0.45, tempete: 0.5, rue: 0.35 }[theme] || 0.38, radius: 0.5, threshold: { automne: 0.97, volcan: 0.95, stade: 0.9 }[theme] || 0.93 },
        fit: (cam, ar) => { const vf = cam.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * ar);
          const d = Math.max((WID / 2) / Math.tan(hf / 2), (SPAN * Math.sin(EL) / 2) / Math.tan(vf / 2) + SPAN * 0.14) + 0.6;
          camBase.pos = new cam.position.constructor(0, d * Math.sin(EL), d * Math.cos(EL)); camBase.look = new cam.position.constructor(0, 0, 0.35);
          cam.position.copy(camBase.pos); cam.lookAt(camBase.look); } });
      const T = S.T, M = S.mats, hw = m.W / 2, hl = m.L / 2, gh = m.goal / 2;
      const decor = D() ? D().build(S, theme, m, ice) : { update() {}, gust() {}, ready: Promise.resolve(), hideGoals: false, hideSurface: false, goalM: M.metal, netColor: 0xffffff };
      // ---- surface
      const tex = D() ? D().surface(T, theme, m, ice) : G3.canvasTex(T, 64, 64, (g) => { g.fillStyle = "#123"; g.fillRect(0, 0, 64, 64); });
      const surf = new T.Mesh(new T.PlaneGeometry(m.W, m.L), new T.MeshStandardMaterial({ map: tex, roughness: ice ? 0.16 : 0.9, metalness: 0, envMapIntensity: ice ? 0.8 : 0.25 }));
      surf.rotation.x = -Math.PI / 2; surf.receiveShadow = true; S.add(surf);
      // ---- bandes (matière selon le décor)
      const railM = { eto: M.obsidian, ocean: new T.MeshPhysicalMaterial({ color: 0xdfe6ec, roughness: 0.12, metalness: 0.9, clearcoat: 1 }), automne: new T.MeshStandardMaterial({ color: 0xb07a35, roughness: 0.28, metalness: 0.95 }),
        sakura: new T.MeshPhysicalMaterial({ color: 0x2a120c, roughness: 0.25, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1 }) }[theme];
      const rx = (!railM && D() && D().railFor) ? D().railFor(T, M, theme) : null;
      const stripM0 = { eto: M.neonRed, ocean: new T.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }), automne: M.gold, sakura: M.gold }[theme];
      const railM2 = railM || (rx ? rx.rail : M.obsidian), stripM = stripM0 || (rx ? rx.strip : M.neonRed), capM = rx ? rx.cap : theme === "eto" ? M.metal : M.gold;
      const wallH = 0.3, wt = 0.22, walls = new T.Group(); S.add(walls);
      const wall = (w, d, x, z) => { const b = new T.Mesh(G3.roundedBox(T, w, wallH, d, 0.09, 3), railM2); b.position.set(x, wallH / 2 - 0.02, z); b.castShadow = true; b.receiveShadow = true; walls.add(b);
        const n = new T.Mesh(w > d ? new T.BoxGeometry(w * 0.96, 0.02, 0.045) : new T.BoxGeometry(0.045, 0.02, d * 0.96), stripM); n.position.set(x, wallH - 0.005, z); walls.add(n); };
      wall(wt, m.L + wt * 2, -hw - wt / 2, 0); wall(wt, m.L + wt * 2, hw + wt / 2, 0);
      [-1, 1].forEach((sgn) => { const seg = hw - gh; wall(seg, wt, -gh - seg / 2, sgn * (hl + wt / 2)); wall(seg, wt, gh + seg / 2, sgn * (hl + wt / 2)); });
      const capG = new T.SphereGeometry(0.15, 20, 12); [[-hw - wt / 2, -hl - wt / 2], [hw + wt / 2, -hl - wt / 2], [-hw - wt / 2, hl + wt / 2], [hw + wt / 2, hl + wt / 2]].forEach(([x, z]) => { const c = new T.Mesh(capG, capM); c.position.set(x, wallH, z); walls.add(c); });
      // ---- cages (filet déformable : il se tend au but)
      const nets = {};
      [-1, 1].forEach((sgn) => {
        const g = new T.Group(), depth = 0.7, hgt = 0.62, post = new T.CylinderGeometry(0.05, 0.05, hgt, 16);
        [-gh, gh].forEach((x) => { const p = new T.Mesh(post, decor.goalM); p.position.set(x, hgt / 2, sgn * hl); p.castShadow = true; g.add(p); });
        const bar = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, m.goal + 0.1, 16), decor.goalM); bar.rotation.z = Math.PI / 2; bar.position.set(0, hgt, sgn * hl); g.add(bar);
        const pts = []; const z0 = sgn * hl, z1 = sgn * (hl + depth);
        for (let i = 0; i <= 12; i++) { const x = -gh + (i / 12) * m.goal; pts.push(x, hgt, z0, x, hgt * 0.75, z1, x, hgt * 0.75, z1, x, 0, z1); }
        for (let j = 0; j <= 6; j++) { const y = (j / 6) * hgt * 0.75; pts.push(-gh, y, z1, gh, y, z1); }
        for (let j = 0; j <= 4; j++) { const k = j / 4; pts.push(-gh, hgt - k * hgt * 0.25, z0 + (z1 - z0) * k, gh, hgt - k * hgt * 0.25, z0 + (z1 - z0) * k); }
        const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
        const net = new T.LineSegments(geo, new T.LineBasicMaterial({ color: decor.netColor, transparent: true, opacity: 0.55 })); g.add(net);
        nets[sgn] = { geo, base: Float32Array.from(pts), bulge: 0, x: 0, sgn };
        const glow = new T.Mesh(new T.PlaneGeometry(m.goal, depth), new T.MeshBasicMaterial({ color: sgn < 0 ? TEAM[0] : TEAM[1], transparent: true, opacity: 0.1, toneMapped: false, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.position.set(0, 0.012, sgn * (hl + depth / 2)); g.add(glow);
        g.visible = !decor.hideGoals; S.add(g);
      });
      const bulgeNet = (n, dt) => { if (n.bulge <= 0.001) return; n.bulge *= Math.pow(0.12, dt); const p = n.geo.attributes.position, b = n.base;
        for (let i = 0; i < p.count; i++) { const x = b[i * 3], y = b[i * 3 + 1], z = b[i * 3 + 2], depthK = Math.abs(z - n.sgn * hl) / 0.7, fall = Math.exp(-((x - n.x) ** 2) / 0.35) * Math.exp(-((y - 0.25) ** 2) / 0.12);
          p.setXYZ(i, x, y, z + n.sgn * n.bulge * fall * (0.3 + depthK * 0.7)); }
        p.needsUpdate = true; };
      // ---- palets : socle cerclé d'or, dôme brillant au drapeau, halo d'équipe
      const discH = 0.16, gDisc = G3.disc(T, m.disc, discH, 0.05, 48), loader = new T.TextureLoader();
      const domeG = (() => { const g = new T.SphereGeometry(m.disc * 0.93, 40, 14, 0, Math.PI * 2, 0, Math.PI / 3.2), p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (m.disc * 1.86) + 0.5, 0.5 - p.getZ(i) / (m.disc * 1.86)); return g; })();
      await G3.pack("flags");
      const flagMat = (code) => { const t = loader.load(G3.src("img/games/flick/flag_" + code + ".webp")); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return new T.MeshPhysicalMaterial({ map: t, roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.45 }); };
      const domes = [flagMat(flags[0]), flagMat(flags[1])];
      const haloT = G3.canvasTex(T, 128, 128, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, w * 0.28, w / 2, w / 2, w / 2); r.addColorStop(0, "rgba(255,255,255,0.9)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, w, w); });
      const meshes = st.bodies.map((b) => { const g = new T.Group(); const d = new T.Mesh(gDisc, M.gold); d.castShadow = true; g.add(d);
        const dm = new T.Mesh(domeG, domes[b.t]); dm.position.y = discH - m.disc * 0.93 * Math.cos(Math.PI / 3.2) + 0.002; dm.rotation.y = b.t ? Math.PI : 0; g.add(dm);
        const halo = new T.Mesh(new T.PlaneGeometry(m.disc * 3.2, m.disc * 3.2), new T.MeshBasicMaterial({ map: haloT, color: TEAM[b.t], transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false })); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.01; g.add(halo); g.userData.halo = halo;
        S.add(g); return g; });
      // balle / palet de hockey
      let ballM;
      if (ice) { ballM = new T.Group(); const pk = new T.Mesh(new T.CylinderGeometry(m.ball, m.ball, 0.12, 32), new T.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.4 })); pk.position.y = 0.06; pk.castShadow = true; ballM.add(pk); const rg = new T.Mesh(new T.TorusGeometry(m.ball, 0.015, 8, 40), M.neonRed); rg.rotation.x = Math.PI / 2; rg.position.y = 0.06; ballM.add(rg); }
      else { const bt = G3.canvasTex(T, 512, 256, (g, w, h) => { g.fillStyle = "#f4f4f4"; g.fillRect(0, 0, w, h); g.fillStyle = "#111"; for (let i = 0; i < 12; i++) { const x = (i % 6) * (w / 6) + (Math.floor(i / 6) ? w / 12 : 0), y = Math.floor(i / 6) ? h * 0.7 : h * 0.3; g.beginPath(); for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; g.lineTo(x + Math.cos(a) * 26, y + Math.sin(a) * 26); } g.closePath(); g.fill(); } });
        ballM = new T.Mesh(new T.SphereGeometry(m.ball, 32, 20), new T.MeshPhysicalMaterial({ map: bt, roughness: 0.3, clearcoat: 0.7 })); ballM.castShadow = true; }
      S.add(ballM);
      // ---- traînées de vitesse
      const ballTrail = G3.trail(S, { color: ice ? 0xff3d63 : 0xbff6ff, len: 30, width: m.ball * 1.15, y: ice ? 0.07 : m.ball, max: m.max * 0.6 });
      const discTrails = st.bodies.map((b) => G3.trail(S, { color: TEAM[b.t], len: 18, width: m.disc * 0.8, y: 0.05, max: m.max * 0.65 }));
      // ---- éclats (étincelles aux chocs, confettis au but)
      const sparkT = G3.canvasTex(T, 64, 64, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.3, "rgba(255,255,255,0.6)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, w, w); });
      const NB = 160, bits = new T.InstancedMesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: sparkT, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }), NB);
      const conf = new T.InstancedMesh(new T.PlaneGeometry(1, 0.6), new T.MeshStandardMaterial({ side: T.DoubleSide, roughness: 0.4, metalness: 0.3 }), NB);
      [bits, conf].forEach((x) => { x.frustumCulled = false; x.count = 0; S.add(x); });
      const P1 = [], P2 = [], dm0 = new T.Object3D(), cc = new T.Color();
      const sparks = (x, z, n, col, spd) => { for (let i = 0; i < n && P1.length < NB; i++) { const a = Math.random() * Math.PI * 2, v = (0.6 + Math.random()) * (spd || 2.5); P1.push({ x, y: 0.15, z, vx: Math.cos(a) * v, vy: Math.random() * v * 0.8, vz: Math.sin(a) * v, life: 0.35 + Math.random() * 0.3, t: 0, s: 0.08 + Math.random() * 0.1, c: col }); } };
      const confetti = (x, z, cols) => { for (let i = 0; i < 110 && P2.length < NB; i++) { const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 5; P2.push({ x, y: 0.3, z, vx: Math.cos(a) * v * 0.6, vy: 3 + Math.random() * 5, vz: Math.sin(a) * v * 0.6, rx: Math.random() * 6, rz: Math.random() * 6, vr: 4 + Math.random() * 8, life: 2.2 + Math.random(), t: 0, s: 0.09 + Math.random() * 0.07, c: cols[i % cols.length] }); } };
      const stepBits = (dt) => {
        for (let i = P1.length - 1; i >= 0; i--) { const p = P1[i]; p.t += dt; if (p.t > p.life) { P1.splice(i, 1); continue; } p.vy -= 6 * dt; p.x += p.vx * dt; p.y = Math.max(0.02, p.y + p.vy * dt); p.z += p.vz * dt; }
        P1.forEach((p, i) => { const k = 1 - p.t / p.life; dm0.position.set(p.x, p.y, p.z); dm0.quaternion.copy(S.camera.quaternion); dm0.scale.setScalar(p.s * (0.4 + k)); dm0.updateMatrix(); bits.setMatrixAt(i, dm0.matrix); bits.setColorAt(i, cc.set(p.c).multiplyScalar(k * 2)); });
        bits.count = P1.length; bits.instanceMatrix.needsUpdate = true; if (bits.instanceColor) bits.instanceColor.needsUpdate = true;
        for (let i = P2.length - 1; i >= 0; i--) { const p = P2[i]; p.t += dt; if (p.t > p.life) { P2.splice(i, 1); continue; } p.vy -= 7 * dt; p.vx *= 0.985; p.vz *= 0.985; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y < 0.02) { p.y = 0.02; p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; } else { p.rx += p.vr * dt; p.rz += p.vr * 0.6 * dt; } }
        P2.forEach((p, i) => { dm0.position.set(p.x, p.y, p.z); dm0.rotation.set(p.rx, 0, p.rz); dm0.scale.setScalar(p.s * Math.min(1, (p.life - p.t) * 2)); dm0.updateMatrix(); conf.setMatrixAt(i, dm0.matrix); conf.setColorAt(i, cc.set(p.c)); });
        conf.count = P2.length; conf.instanceMatrix.needsUpdate = true; if (conf.instanceColor) conf.instanceColor.needsUpdate = true; };
      // onde de choc
      const ringT = G3.canvasTex(T, 256, 256, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, w * 0.36, w / 2, w / 2, w / 2); r.addColorStop(0, "rgba(255,255,255,0)"); r.addColorStop(0.6, "rgba(255,255,255,0.9)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, w, w); });
      const waves = [];
      const shock = (x, z, col, size) => { const w = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: ringT, color: col, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false })); w.rotation.x = -Math.PI / 2; w.position.set(x, 0.06, z); S.add(w); waves.push({ w, t: 0, size: size || 6 }); };
      const stepWaves = (dt) => { for (let i = waves.length - 1; i >= 0; i--) { const q = waves[i]; q.t += dt; const k = q.t / 0.8; if (k >= 1) { S.scene.remove(q.w); q.w.geometry.dispose(); q.w.material.dispose(); waves.splice(i, 1); continue; } q.w.scale.setScalar(0.3 + q.size * (1 - Math.pow(1 - k, 3))); q.w.material.opacity = 1 - k; } };
      // ---- visée
      const aimG = new T.Group(); aimG.visible = false; S.add(aimG);
      const aimShaft = new T.Mesh(new T.BoxGeometry(0.08, 0.02, 1), new T.MeshBasicMaterial({ color: 0xff3d63, toneMapped: false, transparent: true, opacity: 0.95 })); aimShaft.position.y = 0.05; aimG.add(aimShaft);
      const aimHead = new T.Mesh(new T.ConeGeometry(0.16, 0.34, 3), new T.MeshBasicMaterial({ color: 0x1acfd6, toneMapped: false })); aimHead.rotation.x = Math.PI / 2; aimHead.position.y = 0.05; aimG.add(aimHead);
      const powerRing = new T.Mesh(new T.RingGeometry(m.disc * 1.25, m.disc * 1.45, 48), new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.8, side: T.DoubleSide })); powerRing.rotation.x = -Math.PI / 2; powerRing.position.y = 0.03; aimG.add(powerRing);
      const selRing = new T.Mesh(new T.RingGeometry(m.disc * 1.05, m.disc * 1.25, 48), new T.MeshBasicMaterial({ color: 0xe8b54a, toneMapped: false, transparent: true, opacity: 0.9, side: T.DoubleSide })); selRing.rotation.x = -Math.PI / 2; selRing.position.y = 0.025; S.add(selRing); selRing.visible = false;
      const showAim = (b, dx, dz, p) => { const len = 0.6 + p * 2.6, a = Math.atan2(dx, dz); aimG.visible = true; aimG.position.set(b.x, 0, b.z); aimG.rotation.y = a;
        aimShaft.scale.z = len; aimShaft.position.z = m.disc + len / 2; aimHead.position.z = m.disc + len + 0.12; aimShaft.material.color.setHSL(0.97 - p * 0.47, 1, 0.55); powerRing.scale.setScalar(1 + p * 0.6); powerRing.material.color.setHSL(0.97 - p * 0.47, 1, 0.6); };
      // ---- synchro + HUD
      const sync = () => { st.bodies.forEach((b, i) => meshes[i].position.set(b.x, 0, b.z)); ballM.position.set(st.ball.x, ice ? 0 : m.ball, st.ball.z); };
      const roll = new T.Vector3();
      api.hud.innerHTML = `<div class="fl-score" id="fl-score"></div>`;
      let shownScore = "";
      const score = () => { const sc = st.score.join(" – "), bump = shownScore && shownScore !== sc; shownScore = sc;
        api.hud.querySelector("#fl-score").innerHTML = `<span class="t0${st.turn === 0 && !st.over ? " on" : ""}"><img src="img/games/flick/flag_${flags[0]}.webp" alt="">${esc(P[0].name)}</span><b class="${bump ? "bump" : ""}">${st.score[0]}<i>–</i>${st.score[1]}</b><span class="t1${st.turn === 1 && !st.over ? " on" : ""}">${esc(P[1].name)}<img src="img/games/flick/flag_${flags[1]}.webp" alt=""></span>`;
        api.turn(st.over ? "" : (P[st.turn].human ? (bot ? "À toi" : P[st.turn].name) : P[st.turn].name + " vise…"), st.turn); };
      sync(); score();
      // ---- caméra : travelling d'ouverture (rasant, depuis derrière le but) puis pose de jeu ; « punch » vers le but marqué
      const cam = S.camera, look = new T.Vector3(); let intro = 0, punch = null;
      const introFrom = { pos: theme === "stade" ? new T.Vector3(hw * 1.1, 2.6, hl + 3.2) : new T.Vector3(hw * 1.4, theme === "sakura" ? 4.2 : 2.4, hl + 8.5), look: new T.Vector3(0, 0.2, -1.5) };
      const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
      const placeCam = (dt) => {
        if (!camBase.pos) return;
        if (intro < 1) { intro = Math.min(1, intro + dt / 2.6); const k = ease(intro); cam.position.lerpVectors(introFrom.pos, camBase.pos, k); look.lerpVectors(introFrom.look, camBase.look, k); }
        else { cam.position.copy(camBase.pos); look.copy(camBase.look); }
        if (punch) { punch.t += dt; const k = Math.sin(Math.min(1, punch.t / punch.d) * Math.PI) * punch.a; cam.position.lerp(punch.to, k * 0.18); look.lerp(punch.to, k * 0.5); if (punch.t >= punch.d) punch = null; }
        cam.lookAt(look);
      };
      // ---- boucle
      let running = false, alive = true, slow = null, myTurnPulse = 0;
      let lastT = 0;
      S.onFrame((frameDt, t) => {
        const real = lastT ? Math.min(0.25, t - lastT) : 1 / 60; lastT = t;           // physique au temps réel, quel que soit le nombre d'images par seconde
        decor.update(frameDt, t); stepBits(frameDt); stepWaves(frameDt); Object.values(nets).forEach((n) => bulgeNet(n, frameDt)); placeCam(frameDt);
        // halos de l'équipe au trait
        myTurnPulse += frameDt; meshes.forEach((g, i) => { const h = g.userData.halo; const on = !running && !st.over && st.bodies[i].t === st.turn; h.material.opacity += ((on ? 0.35 + Math.sin(myTurnPulse * 4) * 0.15 : 0) - h.material.opacity) * Math.min(1, frameDt * 8); });
        if (slow) { slow.t += frameDt; const k = Math.min(1, slow.t / slow.d), e = 1 - Math.pow(1 - k, 3); ballM.position.x = slow.x0 + slow.dx * e; ballM.position.z = slow.z0 + slow.dz * e; if (!ice) ballM.rotateOnWorldAxis(roll, frameDt * 3 * (1 - k)); ballTrail.push(ballM.position.x, ballM.position.z, slow.v * (1 - k)); if (k >= 1) slow = null; return; }
        if (!running) { ballTrail.push(st.ball.x, st.ball.z, 0); st.bodies.forEach((b, i) => discTrails[i].push(b.x, b.z, 0)); return; }
        const dt = real, sub = Math.max(4, Math.ceil(dt / (1 / 240))); let res = null;
        for (let k = 0; k < sub; k++) { res = F.step(st, dt / sub); if (res.goal != null) break;
          for (const im of res.impacts || []) if (im.v > 0.25) { const inten = Math.min(1, im.v / (m.max * 0.7)); api.sfx("flick." + im.k, { intensity: inten, pan: im.x / hw, rate: ice ? 1.12 : 1 });
            if (inten > 0.25) { sparks(im.x, im.z == null ? 0 : im.z, Math.round(4 + inten * 10), im.k === "ball" ? "#ffffff" : im.k === "post" ? "#ffe39a" : theme === "eto" ? "#ff3d63" : "#ffffff", 1.5 + inten * 3); if (inten > 0.55) S.shake(0.04 + inten * 0.08, 0.2); } } }
        if (!ice) { const sp = Math.hypot(st.ball.vx, st.ball.vz); if (sp > 0) { roll.set(st.ball.vz, 0, -st.ball.vx).normalize(); ballM.rotateOnWorldAxis(roll, (sp * dt) / m.ball); } }
        sync();
        ballTrail.push(st.ball.x, st.ball.z, Math.hypot(st.ball.vx, st.ball.vz)); st.bodies.forEach((b, i) => discTrails[i].push(b.x, b.z, Math.hypot(b.vx, b.vz)));
        if (res.goal != null) { running = false; return goal(res.goal); }
        if (!F.moving(st)) { running = false; F.endShot(st, null); score(); setTimeout(turn, 250); }
      });
      // ---- bannière et flash
      const banner = (team, kmh, tier) => { const d = document.createElement("div"); d.className = "fl-goal t" + team; d.innerHTML = `<b>BUT !</b><span>${kmh} km/h${tier ? ` · ${tier}` : ""}</span>`; api.stage.appendChild(d); setTimeout(() => d.remove(), 2200);
        const f = document.createElement("div"); f.className = "fl-flash t" + team; api.stage.appendChild(f); setTimeout(() => f.remove(), 700); };
      const goal = async (team) => {
        const b = st.ball, sp = Math.hypot(b.vx, b.vz), pow = Math.min(1, sp / (m.max * 0.72)), kmh = Math.round(sp * 8), sgn = b.z < 0 ? -1 : 1;
        const tier = pow > 0.85 ? "Frappe monstrueuse" : pow > 0.6 ? "Puissant" : pow < 0.25 ? "En douceur" : "";
        // ralenti : la balle file au fond du filet
        roll.set(b.vz, 0, -b.vx).normalize(); slow = { t: 0, d: 0.9, x0: b.x, z0: b.z, dx: (b.vx / (sp || 1)) * 0.35, dz: sgn * (0.58 - Math.abs(Math.abs(b.z) - hl)), v: sp };
        const n = nets[sgn]; n.x = b.x; n.bulge = 0.18 + pow * 0.35;
        S.shake(0.12 + pow * 0.5, 0.45 + pow * 0.45); decor.gust(1.5 + pow * 3);
        const bl = S.bloom(); if (bl) { const s0 = bl.strength; bl.strength = s0 + 0.8 + pow; G3.tween(1.2, (k) => (bl.strength = s0 + (0.8 + pow) * (1 - k))); }
        punch = { t: 0, d: 0.9, a: 0.6 + pow * 0.6, to: new T.Vector3(b.x, 0.3, sgn * hl) };
        shock(b.x, sgn * hl, TEAM[team], 4 + pow * 6); shock(b.x, sgn * hl, 0xffffff, 2 + pow * 3);
        sparks(b.x, sgn * hl, 30 + Math.round(pow * 30), team ? "#ff3d63" : "#45d8ff", 3 + pow * 4); confetti(b.x, sgn * (hl - 0.5), team ? ["#ff3d63", "#ffffff", "#e8b54a"] : ["#45d8ff", "#ffffff", "#e8b54a"]);
        api.vibrate([30, 40, Math.round(60 + pow * 120)]); api.sfx("flick.post", { intensity: pow, rate: 0.8 }); api.sfx("flick.goal", { vol: 0.6 + pow * 0.4 }); api.sfx("fx.stinger", { vol: 0.5 + pow * 0.4 });
        banner(team, kmh, tier);
        F.endShot(st, team); score();
        await new Promise((r) => setTimeout(r, 2000)); if (!alive) return;
        if (st.over) return api.end(st.over.winner, st.score.join(" – "));
        ballTrail.clear(); discTrails.forEach((x) => x.clear()); sync(); turn();
      };
      // ---- tir : souffle, poussière, rafale de vent
      const kick = (i, power) => { const b = st.bodies[i]; api.sfx("flick.shot", { intensity: power }); decor.gust(0.6 + power * 1.6); if (power > 0.55) S.shake(0.03 + power * 0.06, 0.18); shock(b.x, b.z, 0xffffff, 1 + power * 1.8); sparks(b.x, b.z, Math.round(power * 8), "#ffffff", 1.2); };
      // ---- tours
      const turn = async () => {
        if (!alive || st.over) return; score(); selRing.visible = false; aimG.visible = false;
        if (bot && st.turn === 1) {
          await new Promise((r) => setTimeout(r, 500)); if (!alive) return;
          const sh = F.bestShot(st, P[1].level || "normal"); const b = st.bodies[sh.idx]; selRing.visible = true; selRing.position.set(b.x, 0, b.z);
          await G3.tween(0.6, (k) => showAim(b, sh.dx, sh.dz, sh.power * k)); await new Promise((r) => setTimeout(r, 150));
          aimG.visible = false; selRing.visible = false; F.shoot(st, sh.idx, sh.dx, sh.dz, sh.power); kick(sh.idx, sh.power); running = true;
        }
      };
      // ---- fronde au doigt
      let drag = null;
      const cv = S.renderer.domElement;
      cv.addEventListener("pointerdown", (e) => {
        if (running || slow || st.over || (bot && st.turn === 1)) return; const p = S.ground(e.clientX, e.clientY, 0.1); if (!p) return;
        let best = -1, bd = 1e9; st.bodies.forEach((b, i) => { if (b.t !== st.turn) return; const d = Math.hypot(b.x - p.x, b.z - p.z); if (d < bd) { bd = d; best = i; } });
        if (best < 0 || bd > m.disc * 2.2) return;
        drag = { i: best, x0: p.x, z0: p.z }; selRing.visible = true; selRing.position.set(st.bodies[best].x, 0, st.bodies[best].z); cv.setPointerCapture && cv.setPointerCapture(e.pointerId); api.vibrate(6);
      });
      cv.addEventListener("pointermove", (e) => { if (!drag) return; const p = S.ground(e.clientX, e.clientY, 0.1); if (!p) return; const b = st.bodies[drag.i], dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz); drag.dx = dx; drag.dz = dz; drag.p = Math.min(1, d / 2.4); if (d > 0.15) showAim(b, dx, dz, drag.p); });
      const release = () => { if (!drag) return; const d = drag; drag = null; aimG.visible = false; selRing.visible = false; if (!d.p || d.p < 0.06) return; F.shoot(st, d.i, d.dx, d.dz, d.p); api.vibrate(10); kick(d.i, d.p); running = true; };
      cv.addEventListener("pointerup", release); cv.addEventListener("pointercancel", () => { drag = null; aimG.visible = false; selRing.visible = false; });
      await decor.ready; if (!alive) return;
      surf.visible = !decor.hideSurface || ice;
      Object.values(nets).forEach(() => {});
      turn();
      api.loop("flick.amb", { vol: theme === "eto" ? 1 : 0.55 });
      return { destroy: () => { alive = false; S.dispose(); }, _st: () => st, _theme: () => theme, _intro: () => intro,
        _shoot: (i, dx, dz, p) => { if (running || slow) return false; const ok = F.shoot(st, i, dx, dz, p); if (ok) { kick(i, p); running = true; } return ok; } };
    },
  });
})();
