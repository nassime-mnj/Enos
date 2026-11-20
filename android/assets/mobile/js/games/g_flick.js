"use strict";
// FLICK FOOT / FLICK HOCKEY 3D : terrain vu en plongée (gazon sombre et lignes néon, ou glace), palets à drapeaux sous dôme de verre,
// cages chromées avec filets. Tir à la fronde : tire en arrière depuis un de tes palets, relâche. Physique : js/games/flick_rules.js.
(() => {
  const E = window.ENOS, G3 = E.g3d, F = E.flick, esc = E.esc;
  if (!E.jeux || !G3 || !F) return;
  const FLAGS = [["fr", "France"], ["br", "Brésil"], ["ar", "Argentine"], ["de", "Allemagne"], ["es", "Espagne"], ["it", "Italie"], ["pt", "Portugal"], ["gb", "Royaume-Uni"],
    ["nl", "Pays-Bas"], ["be", "Belgique"], ["ma", "Maroc"], ["dz", "Algérie"], ["sn", "Sénégal"], ["jp", "Japon"], ["us", "États-Unis"], ["mx", "Mexique"]];
  const RULES = `<p>Chacun son tour : <b>tire en arrière</b> sur un de tes palets, comme une fronde, puis relâche. Plus tu tires loin, plus le tir est fort.</p><p>Envoie la balle (ou le palet de hockey) dans le but adverse. Après un but, engagement pour l'équipe qui a encaissé. Le premier à atteindre le score fixé gagne.</p>`;

  E.jeux.register({
    id: "flick", title: "Flick Foot", sub: "Foot et hockey de palets, vue du dessus", hero: "img/games/common/hub_bg.webp", min: 2, max: 2, rules: RULES,
    icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/><path d="M12 3v6M12 15v6"/>',
    options: [{ key: "mode", label: "Terrain", def: "foot", choices: [["foot", "Football"], ["hockey", "Hockey"]] }, { key: "goals", label: "Buts pour gagner", def: 3, choices: [[3, "3"], [5, "5"], [7, "7"]] },
      { key: "t0", label: "Équipe 1", def: "fr", choices: FLAGS, img: (v) => "img/games/flick/flag_" + v + ".webp" }, { key: "t1", label: "Équipe 2", def: "br", choices: FLAGS, img: (v) => "img/games/flick/flag_" + v + ".webp" }],
    async start(host, setup, api) {
      const o = setup.opts || {}, P = setup.players, bot = setup.mode === "bots";
      let st = F.newGame(o.mode || "foot", o.goals || 3);
      { const tb = api.stage && api.stage.querySelector(".gm-top b"); if (tb) tb.textContent = st.mode === "hockey" ? "Flick Hockey" : "Flick Foot"; }
      const m = st.m, ice = st.mode === "hockey", flags = [o.t0 || "fr", (o.t1 && o.t1 !== o.t0) ? o.t1 : (o.t0 === "br" ? "fr" : "br")];
      const EL = 66 * Math.PI / 180, SPAN = m.L + 2.4, WID = m.W + 1.8;
      const S = await G3.stage(host, { fov: 40, exposure: 1.0, fog: 0.012, cam: [0, 14, 6], look: [0, 0, 0],
        fit: (cam, ar) => { const vf = cam.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * ar);
          const d = Math.max((WID / 2) / Math.tan(hf / 2), (SPAN * Math.sin(EL) / 2) / Math.tan(vf / 2) + SPAN * 0.14) + 0.6;
          cam.position.set(0, d * Math.sin(EL), d * Math.cos(EL)); cam.lookAt(0, 0, 0.35); } });
      const T = S.T, M = S.mats, hw = m.W / 2, hl = m.L / 2, gh = m.goal / 2;
      G3.backdrop(S, { y: -0.35, glow: 26 });
      // ---- surface
      const tex = G3.canvasTex(T, 1024, Math.round(1024 * m.L / m.W), (g, w, h) => {
        if (ice) { const lg = g.createLinearGradient(0, 0, w, h); lg.addColorStop(0, "#dfe7ee"); lg.addColorStop(1, "#c6d2dd"); g.fillStyle = lg; g.fillRect(0, 0, w, h);
          for (let i = 0; i < 260; i++) { g.strokeStyle = `rgba(255,255,255,${Math.random() * 0.35})`; g.lineWidth = Math.random() * 1.6; g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 40); g.stroke(); } }
        else { for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? "#0d1f15" : "#112619"; g.fillRect(0, (i / 12) * h, w, h / 12 + 1); } for (let i = 0; i < 16000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 3); } }
        const sx = w / m.W, line = (c, wdt) => { g.strokeStyle = c; g.lineWidth = wdt; g.shadowColor = c; g.shadowBlur = ice ? 0 : 14; };
        const X = (x) => (x + hw) * sx, Z = (z) => (z + hl) * sx;
        if (ice) { line("#ef1748", 10); g.beginPath(); g.moveTo(0, Z(0)); g.lineTo(w, Z(0)); g.stroke(); line("#1aa3d6", 9); [-m.L * 0.2, m.L * 0.2].forEach((z) => { g.beginPath(); g.moveTo(0, Z(z)); g.lineTo(w, Z(z)); g.stroke(); });
          line("#ef1748", 5); [-1, 1].forEach((sgn) => { g.beginPath(); g.moveTo(0, Z(sgn * (hl - 0.5))); g.lineTo(w, Z(sgn * (hl - 0.5))); g.stroke(); g.beginPath(); g.arc(X(0), Z(sgn * (hl - 0.5)), gh * sx, sgn > 0 ? Math.PI : 0, sgn > 0 ? Math.PI * 2 : Math.PI); g.fillStyle = "rgba(26,163,214,0.25)"; g.fill(); g.stroke(); });
          line("#1aa3d6", 6); g.beginPath(); g.arc(X(0), Z(0), 1.0 * sx, 0, Math.PI * 2); g.stroke(); }
        else { line("#ff3d63", 7); g.strokeRect(6, 6, w - 12, h - 12); g.beginPath(); g.moveTo(0, Z(0)); g.lineTo(w, Z(0)); g.stroke(); g.beginPath(); g.arc(X(0), Z(0), 1.1 * sx, 0, Math.PI * 2); g.stroke();
          g.fillStyle = "#ff3d63"; g.beginPath(); g.arc(X(0), Z(0), 8, 0, Math.PI * 2); g.fill();
          [-1, 1].forEach((sgn) => { const zz = Z(sgn * hl), bw = 3.4 * sx, bd = 1.5 * sx, sw = 1.9 * sx, sd = 0.55 * sx; g.strokeRect(X(0) - bw / 2, sgn < 0 ? zz : zz - bd, bw, bd); g.strokeRect(X(0) - sw / 2, sgn < 0 ? zz : zz - sd, sw, sd);
            g.beginPath(); g.arc(X(0), Z(sgn * (hl - 1.5)), 0.7 * sx, sgn < 0 ? 0.2 : Math.PI + 0.2, sgn < 0 ? Math.PI - 0.2 : Math.PI * 2 - 0.2); g.stroke(); }); }
      });
      const surf = new T.Mesh(new T.PlaneGeometry(m.W, m.L), new T.MeshStandardMaterial({ map: tex, roughness: ice ? 0.18 : 0.92, metalness: 0, envMapIntensity: ice ? 0.8 : 0.2 }));
      surf.rotation.x = -Math.PI / 2; surf.receiveShadow = true; S.add(surf);
      // ---- bandes (obsidienne + néon)
      const wallH = 0.32, wt = 0.22, walls = new T.Group(); S.add(walls);
      const wall = (w, d, x, z) => { const b = new T.Mesh(G3.roundedBox(T, w, wallH, d, 0.08, 2), M.obsidian); b.position.set(x, wallH / 2 - 0.02, z); b.castShadow = true; walls.add(b); const n = new T.Mesh(w > d ? new T.BoxGeometry(w * 0.98, 0.025, 0.05) : new T.BoxGeometry(0.05, 0.025, d * 0.98), M.neonRed); n.position.set(x, wallH + 0.0, z); walls.add(n); };
      wall(wt, m.L + wt * 2, -hw - wt / 2, 0); wall(wt, m.L + wt * 2, hw + wt / 2, 0);
      [-1, 1].forEach((sgn) => { const seg = hw - gh; wall(seg, wt, -gh - seg / 2, sgn * (hl + wt / 2)); wall(seg, wt, gh + seg / 2, sgn * (hl + wt / 2)); });
      // ---- cages
      const netM = new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
      [-1, 1].forEach((sgn) => {
        const g = new T.Group(), depth = 0.7, hgt = 0.62, post = new T.CylinderGeometry(0.05, 0.05, hgt, 16);
        [-gh, gh].forEach((x) => { const p = new T.Mesh(post, M.metal); p.position.set(x, hgt / 2, sgn * hl); p.castShadow = true; g.add(p); });
        const bar = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, m.goal + 0.1, 16), M.metal); bar.rotation.z = Math.PI / 2; bar.position.set(0, hgt, sgn * hl); g.add(bar);
        const pts = []; const z0 = sgn * hl, z1 = sgn * (hl + depth);
        for (let i = 0; i <= 10; i++) { const x = -gh + (i / 10) * m.goal; pts.push(x, hgt, z0, x, hgt * 0.75, z1, x, hgt * 0.75, z1, x, 0, z1); }
        for (let j = 0; j <= 5; j++) { const y = (j / 5) * hgt * 0.75; pts.push(-gh, y, z1, gh, y, z1); }
        for (let j = 0; j <= 4; j++) { const k = j / 4; pts.push(-gh, hgt - k * hgt * 0.25, z0 + (z1 - z0) * k, gh, hgt - k * hgt * 0.25, z0 + (z1 - z0) * k); }
        const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(pts, 3)); g.add(new T.LineSegments(geo, netM));
        const glow = new T.Mesh(new T.PlaneGeometry(m.goal, depth), new T.MeshBasicMaterial({ color: sgn < 0 ? 0xe8b54a : 0xef1748, transparent: true, opacity: 0.12, toneMapped: false })); glow.rotation.x = -Math.PI / 2; glow.position.set(0, 0.01, sgn * (hl + depth / 2)); g.add(glow);
        S.add(g);
      });
      // ---- palets
      const discH = 0.17, gDisc = G3.disc(T, m.disc, discH, 0.05, 48), loader = new T.TextureLoader();
      const flagMat = (code) => { const t = loader.load("img/games/flick/flag_" + code + ".webp"); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return new T.MeshStandardMaterial({ map: t, roughness: 0.45, metalness: 0, envMapIntensity: 0.35 }); };
      const capG = new T.CircleGeometry(m.disc * 0.86, 48), domeG = new T.SphereGeometry(m.disc * 0.9, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2.6);
      const domeM = new T.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, roughness: 0.02, clearcoat: 1, metalness: 0, depthWrite: false });
      const rimM = [M.gold, new T.MeshStandardMaterial({ color: 0xc8143c, roughness: 0.25, metalness: 0.7 })];
      const caps = [flagMat(flags[0]), flagMat(flags[1])];
      const meshes = st.bodies.map((b) => { const g = new T.Group(); const d = new T.Mesh(gDisc, rimM[b.t]); d.castShadow = true; g.add(d); const c = new T.Mesh(capG, caps[b.t]); c.rotation.x = -Math.PI / 2; c.rotation.z = b.t ? Math.PI : 0; c.position.y = discH + 0.002; g.add(c);
        const dm = new T.Mesh(domeG, domeM); dm.position.y = discH - m.disc * 0.62; dm.scale.y = 0.55; g.add(dm); S.add(g); return g; });
      // balle / palet de hockey
      let ballM;
      if (ice) { ballM = new T.Group(); const pk = new T.Mesh(new T.CylinderGeometry(m.ball, m.ball, 0.12, 32), new T.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.5 })); pk.position.y = 0.06; pk.castShadow = true; ballM.add(pk); const rg = new T.Mesh(new T.TorusGeometry(m.ball, 0.015, 8, 40), M.neonRed); rg.rotation.x = Math.PI / 2; rg.position.y = 0.06; ballM.add(rg); }
      else { const bt = G3.canvasTex(T, 512, 256, (g, w, h) => { g.fillStyle = "#f2f2f2"; g.fillRect(0, 0, w, h); g.fillStyle = "#111"; for (let i = 0; i < 12; i++) { const x = (i % 6) * (w / 6) + (Math.floor(i / 6) ? w / 12 : 0), y = Math.floor(i / 6) ? h * 0.7 : h * 0.3; g.beginPath(); for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; g.lineTo(x + Math.cos(a) * 26, y + Math.sin(a) * 26); } g.closePath(); g.fill(); } g.strokeStyle = "#ef1748"; g.lineWidth = 3; g.strokeRect(0, h / 2 - 1, w, 2); });
        ballM = new T.Mesh(new T.SphereGeometry(m.ball, 32, 20), new T.MeshPhysicalMaterial({ map: bt, roughness: 0.35, clearcoat: 0.6 })); ballM.castShadow = true; }
      S.add(ballM);
      // ---- visée
      const aimG = new T.Group(); aimG.visible = false; S.add(aimG);
      const aimShaft = new T.Mesh(new T.BoxGeometry(0.08, 0.02, 1), new T.MeshBasicMaterial({ color: 0xff3d63, toneMapped: false, transparent: true, opacity: 0.95 })); aimShaft.position.y = 0.05; aimG.add(aimShaft);
      const aimHead = new T.Mesh(new T.ConeGeometry(0.16, 0.34, 3), new T.MeshBasicMaterial({ color: 0x1acfd6, toneMapped: false })); aimHead.rotation.x = Math.PI / 2; aimHead.position.y = 0.05; aimG.add(aimHead);
      const powerRing = new T.Mesh(new T.RingGeometry(m.disc * 1.25, m.disc * 1.45, 48), new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.8, side: T.DoubleSide })); powerRing.rotation.x = -Math.PI / 2; powerRing.position.y = 0.03; aimG.add(powerRing);
      const selRing = new T.Mesh(new T.RingGeometry(m.disc * 1.05, m.disc * 1.25, 48), new T.MeshBasicMaterial({ color: 0xe8b54a, toneMapped: false, transparent: true, opacity: 0.9, side: T.DoubleSide })); selRing.rotation.x = -Math.PI / 2; selRing.position.y = 0.025; S.add(selRing); selRing.visible = false;
      const showAim = (b, dx, dz, p) => { const len = 0.6 + p * 2.6, a = Math.atan2(dx, dz); aimG.visible = true; aimG.position.set(b.x, 0, b.z); aimG.rotation.y = a;
        aimShaft.scale.z = len; aimShaft.position.z = m.disc + len / 2; aimHead.position.z = m.disc + len + 0.12; aimShaft.material.color.setHSL(0.97 - p * 0.47, 1, 0.55); powerRing.scale.setScalar(1 + p * 0.6); };
      // ---- synchro + HUD
      const sync = () => { st.bodies.forEach((b, i) => meshes[i].position.set(b.x, 0, b.z)); ballM.position.set(st.ball.x, ice ? 0 : m.ball, st.ball.z); };
      const roll = new T.Vector3();
      api.hud.innerHTML = `<div class="fl-score" id="fl-score"></div>`;
      const score = () => { api.hud.querySelector("#fl-score").innerHTML = `<span class="t0"><img src="img/games/flick/flag_${flags[0]}.webp" alt="">${esc(P[0].name)}</span><b>${st.score[0]} – ${st.score[1]}</b><span class="t1">${esc(P[1].name)}<img src="img/games/flick/flag_${flags[1]}.webp" alt=""></span>`;
        api.turn(st.over ? "" : (P[st.turn].human ? (bot ? "À toi" : P[st.turn].name) : P[st.turn].name + " vise…"), st.turn); };
      sync(); score();
      // ---- boucle physique
      let running = false, alive = true, lastHits = 0;
      let lastT = 0;
      S.onFrame((_dt, t) => {
        const real = lastT ? Math.min(0.25, t - lastT) : 1 / 60; lastT = t;           // physique au temps réel, quel que soit le nombre d'images par seconde
        if (!running) return;
        const dt = real, sub = Math.max(4, Math.ceil(dt / (1 / 240))); let res = null;
        for (let k = 0; k < sub; k++) { res = F.step(st, dt / sub); if (res.goal != null) break; if (res.hits.length && performance.now() - lastHits > 90) { lastHits = performance.now(); api.sound(res.hits.includes("ball") ? "capture" : "move"); } }
        if (!ice) { const sp = Math.hypot(st.ball.vx, st.ball.vz); if (sp > 0) { roll.set(st.ball.vz, 0, -st.ball.vx).normalize(); ballM.rotateOnWorldAxis(roll, (sp * dt) / m.ball); } }
        sync();
        if (res.goal != null) { running = false; return goal(res.goal); }
        if (!F.moving(st)) { running = false; F.endShot(st, null); score(); setTimeout(turn, 250); }
      });
      const banner = (txt, cls) => { const d = document.createElement("div"); d.className = "fl-banner " + (cls || ""); d.textContent = txt; api.stage.appendChild(d); setTimeout(() => d.remove(), 1500); };
      const goal = async (team) => {
        api.vibrate([30, 60, 30]); api.sound("brilliant"); banner("BUT !", team === 0 ? "t0" : "t1");
        F.endShot(st, team); score();
        await new Promise((r) => setTimeout(r, 1500)); if (!alive) return;
        if (st.over) return api.end(st.over.winner, st.score.join(" – "));
        sync(); turn();
      };
      // ---- tours
      const turn = async () => {
        if (!alive || st.over) return; score(); selRing.visible = false; aimG.visible = false;
        if (bot && st.turn === 1) {
          await new Promise((r) => setTimeout(r, 500)); if (!alive) return;
          const sh = F.bestShot(st, P[1].level || "normal"); const b = st.bodies[sh.idx]; selRing.visible = true; selRing.position.set(b.x, 0, b.z);
          await G3.tween(0.6, (k) => showAim(b, sh.dx, sh.dz, sh.power * k)); await new Promise((r) => setTimeout(r, 150));
          aimG.visible = false; selRing.visible = false; F.shoot(st, sh.idx, sh.dx, sh.dz, sh.power); api.sound("move"); running = true;
        }
      };
      // ---- fronde au doigt
      let drag = null;
      const cv = S.renderer.domElement;
      const ptr = (e) => (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
      cv.addEventListener("pointerdown", (e) => {
        if (running || st.over || (bot && st.turn === 1)) return; const p = S.ground(e.clientX, e.clientY, 0.1); if (!p) return;
        let best = -1, bd = 1e9; st.bodies.forEach((b, i) => { if (b.t !== st.turn) return; const d = Math.hypot(b.x - p.x, b.z - p.z); if (d < bd) { bd = d; best = i; } });
        if (best < 0 || bd > m.disc * 2.2) return;
        drag = { i: best, x0: p.x, z0: p.z }; selRing.visible = true; selRing.position.set(st.bodies[best].x, 0, st.bodies[best].z); cv.setPointerCapture && cv.setPointerCapture(e.pointerId); api.vibrate(6);
      });
      cv.addEventListener("pointermove", (e) => { if (!drag) return; const p = S.ground(e.clientX, e.clientY, 0.1); if (!p) return; const b = st.bodies[drag.i], dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz); drag.dx = dx; drag.dz = dz; drag.p = Math.min(1, d / 2.4); if (d > 0.15) showAim(b, dx, dz, drag.p); });
      const release = () => { if (!drag) return; const d = drag; drag = null; aimG.visible = false; selRing.visible = false; if (!d.p || d.p < 0.06) return; F.shoot(st, d.i, d.dx, d.dz, d.p); api.vibrate(10); api.sound("move"); running = true; };
      cv.addEventListener("pointerup", release); cv.addEventListener("pointercancel", () => { drag = null; aimG.visible = false; selRing.visible = false; });
      turn();
      return { destroy: () => { alive = false; S.dispose(); }, _st: () => st, _shoot: (i, dx, dz, p) => { if (running) return false; const ok = F.shoot(st, i, dx, dz, p); if (ok) running = true; return ok; } };
    },
  });
})();
