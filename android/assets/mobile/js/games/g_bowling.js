"use strict";
// BOWLING 3D : piste aux vraies dimensions (js/games/bowling_rules.js), bois verni qui reflète, flèches de visée, gouttières, quilles tournées,
// boule qui roule et accroche le bois sec en fin de piste (effet). Lancer : glisse vers le haut ; la vitesse du geste donne la force,
// sa courbe donne l'effet ; avant le lancer, glisse à gauche / à droite pour placer la boule. Feuille de score officielle (10 frames).
// Décors : Bowling ETO (néons) + les décors partagés (Stade, Océan, Automne, Sakura, Rue, Volcan, Tempête).
(() => {
  const E = window.ENOS, G3 = E.g3d, B = E.bowling, esc = E.esc;
  if (!E.jeux || !G3 || !B) return;
  const L = B.LANE, PIN_H = 0.381;
  const RULES = `<p>10 frames, 2 boules par frame. <b>Strike</b> (10 quilles à la 1re boule) : 10 + les 2 boules suivantes. <b>Spare</b> (10 en 2 boules) : 10 + la boule suivante. 10e frame : boules bonus après un strike ou un spare.</p>
    <p><b>Placer</b> : glisse à gauche ou à droite. <b>Lancer</b> : glisse vers le haut. Plus le geste est rapide, plus la boule va vite ; un geste courbe donne de l'effet (la boule tourne en fin de piste).</p>`;
  const BALLC = [["#c8102e", "#ff6a7d"], ["#1acfd6", "#0a5a8a"], ["#e8b54a", "#7a4a10"], ["#7c3aed", "#1b0b3a"], ["#22c55e", "#0a3a1a"], ["#f3ead9", "#8a7a60"]];

  E.jeux.register({
    id: "bowling", title: "Bowling", sub: "Strikes, spares et effet en 3D", hero: "img/games/common/card_bowling.webp", min: 1, max: 4, rules: RULES,
    icon: '<circle cx="9" cy="15" r="6"/><path d="M17 3c-1.5 0-2 1.5-2 3s1 2 1 3-1 1.5-1 4 1 4 2 4 2-1.5 2-4-1-3-1-4 1-1.5 1-3-.5-3-2-3z"/>',
    options: [{ key: "frames", label: "Partie", def: 10, choices: [[10, "10 frames"], [5, "5 frames"], [3, "3 frames"]] }, { key: "decor", label: "Décor", def: "eto", choices: [["eto", "Bowling ETO"], ["stade", "Stade"], ["ocean", "Océan"], ["automne", "Automne"], ["sakura", "Sakura"], ["rue", "Rue"], ["volcan", "Volcan"], ["tempete", "Tempête"]] }],
    async start(host, setup, api) {
      const P = setup.players, o = setup.opts || {}, DC = E.flickDecor, theme = DC && DC.IDS.includes(o.decor) ? o.decor : "eto";
      const S = await G3.stage(host, { fov: 46, exposure: 1.05, fog: 0.012, cam: [0, 1.35, 2.6], look: [0, 0.2, -8], bloom: { strength: 0.42, radius: 0.5, threshold: 0.9 } });
      const T = S.T, M = S.mats, hw = L.W / 2, gw = 0.24, mid = -L.len / 2;
      S.key.position.set(-2, 9, -6); S.key.target.position.set(0, 0, -10); S.add(S.key.target); S.key.shadow.camera.left = -4; S.key.shadow.camera.right = 4; S.key.shadow.camera.top = 14; S.key.shadow.camera.bottom = -14; S.key.shadow.camera.updateProjectionMatrix();
      // ---------------------------------------------------------------- décor
      let decor = null;
      if (theme === "eto") { G3.backdrop(S, { y: -0.05, glow: 10 });
        // allée voisine et néons
        [-1, 1].forEach((sg) => { const strip = new T.Mesh(new T.BoxGeometry(0.04, 0.04, 26), sg < 0 ? M.neonRed : M.neonCyan); strip.position.set(sg * (hw + gw + 0.32), 0.02, mid + 1); S.add(strip);
          const lane2 = new T.Mesh(new T.BoxGeometry(L.W, 0.02, 24), new T.MeshPhysicalMaterial({ color: 0x3a2a1c, roughness: 0.25, clearcoat: 1 })); lane2.position.set(sg * 2.1, -0.01, mid); lane2.receiveShadow = true; S.add(lane2); });
        const sign = G3.canvasTex(T, 1024, 256, (g, w, h) => { g.fillStyle = "#05060a"; g.fillRect(0, 0, w, h); g.font = "900 150px Inter, Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.shadowColor = "#ff3d63"; g.shadowBlur = 40; g.fillStyle = "#ff3d63"; g.fillText("ETO BOWL", w / 2, h / 2 + 8); });
        const sg2 = new T.Mesh(new T.PlaneGeometry(4.4, 1.1), new T.MeshBasicMaterial({ map: sign, toneMapped: false, color: new T.Color(1.8, 1.8, 1.8) })); sg2.position.set(0, 1.55, -L.len - 1.55); S.add(sg2); }
      else { decor = DC.mount(S, theme, { W: 3.4, L: 25 }, 0, mid - 0.4); S.onFrame((dt, t) => decor.update(dt, t)); }
      // ---------------------------------------------------------------- piste
      const laneT = G3.canvasTex(T, 256, 2048, (g, w, h) => { const n = 39; for (let i = 0; i < n; i++) { const c = 150 + Math.random() * 40; g.fillStyle = `rgb(${c + 40},${c * 0.72},${c * 0.42})`; g.fillRect((i / n) * w, 0, w / n + 1, h); g.fillStyle = "rgba(60,30,10,0.35)"; g.fillRect((i / n) * w, 0, 1, h); }
        for (let k = 0; k < 3000; k++) { g.fillStyle = `rgba(80,40,10,${Math.random() * 0.08})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 6 + Math.random() * 30); }
        const Z = (z) => h * (-z / L.len);
        // flèches de visée (à 4,6 m) et points (à 2,1 m), points des quilles
        g.fillStyle = "#1b1310"; for (let i = 0; i < 7; i++) { const x = ((i + 1) / 8) * w, y = Z(-4.6) - Math.abs(i - 3) * 22; g.beginPath(); g.moveTo(x, y - 34); g.lineTo(x - 7, y); g.lineTo(x + 7, y); g.closePath(); g.fill(); }
        for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(((i + 1) / 8) * w, Z(-2.1), 3.5, 0, 7); g.fill(); }
        B.PINS.forEach(([x, z]) => { g.beginPath(); g.arc((x / L.W + 0.5) * w, Z(z), 4, 0, 7); g.fill(); }); });
      laneT.anisotropy = 16;
      const laneM = new T.MeshPhysicalMaterial({ map: laneT, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: theme === "eto" ? 0.55 : 0.25 });
      const lane = new T.Mesh(new T.BoxGeometry(L.W, 0.06, L.len + 1.0), laneM); lane.position.set(0, -0.03, -L.len / 2 - 0.5); lane.receiveShadow = true; S.add(lane);
      const appT = G3.canvasTex(T, 256, 512, (g, w, h) => { for (let i = 0; i < 39; i++) { const c = 175 + Math.random() * 30; g.fillStyle = `rgb(${c + 40},${c * 0.8},${c * 0.55})`; g.fillRect((i / 39) * w, 0, w / 39 + 1, h); } g.fillStyle = "#1b1310"; for (let i = 0; i < 5; i++) g.fillRect(((i + 1.5) / 7) * w, h * 0.3, 5, 5); });
      const approach = new T.Mesh(new T.BoxGeometry(L.W + 2 * gw + 0.3, 0.06, 4.6), new T.MeshPhysicalMaterial({ map: appT, roughness: 0.3, clearcoat: 0.6 })); approach.position.set(0, -0.03, 2.3); approach.receiveShadow = true; S.add(approach);
      const foul = new T.Mesh(new T.BoxGeometry(L.W + 2 * gw + 0.3, 0.002, 0.03), new T.MeshBasicMaterial({ color: 0xff3d63, toneMapped: false })); foul.position.set(0, 0.002, 0); S.add(foul);
      // gouttières (demi-tubes) et capots
      const gutM = new T.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.25, metalness: 0.95, side: T.DoubleSide });
      [-1, 1].forEach((sg) => { const gg = new T.Mesh(new T.CylinderGeometry(gw / 2, gw / 2, L.len + 0.4, 20, 1, true, Math.PI / 2, Math.PI), gutM); gg.rotation.x = Math.PI / 2; gg.rotation.y = 0; gg.position.set(sg * (hw + gw / 2), 0, -L.len / 2 - 0.2); S.add(gg);
        const cap = new T.Mesh(G3.roundedBox(T, 0.16, 0.1, L.len + 0.6, 0.04, 2), M.graphite); cap.position.set(sg * (hw + gw + 0.08), 0.0, -L.len / 2 - 0.3); cap.receiveShadow = true; S.add(cap);
        const kick = new T.Mesh(new T.BoxGeometry(0.06, 0.55, 1.8), M.obsidian); kick.position.set(sg * (hw + gw + 0.03), 0.27, -L.len - 0.6); S.add(kick); });
      // fosse, rideau et machine
      const pit = new T.Mesh(new T.BoxGeometry(L.W + 2 * gw + 0.2, 0.3, 1.1), new T.MeshStandardMaterial({ color: 0x050506, roughness: 1 })); pit.position.set(0, -0.2, L.pitZ - 0.45); S.add(pit);
      const curtain = new T.Mesh(new T.PlaneGeometry(L.W + 2 * gw + 0.3, 1.0), new T.MeshStandardMaterial({ color: 0x0a0a0d, roughness: 1 })); curtain.position.set(0, 0.5, L.pitZ - 0.95); S.add(curtain);
      const hood = new T.Mesh(G3.roundedBox(T, L.W + 2 * gw + 0.5, 0.45, 0.9, 0.08, 2), M.obsidian); hood.position.set(0, 1.05, -L.len - 0.75); S.add(hood);
      const hoodLogo = G3.canvasTex(T, 512, 128, (g, w, h) => { g.fillStyle = "#0a0b0e"; g.fillRect(0, 0, w, h); g.font = "900 72px Inter, Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#ff3d63"; g.shadowColor = "#ff3d63"; g.shadowBlur = 20; g.fillText("E.N.O.S.", w / 2, h / 2 + 4); });
      const logo = new T.Mesh(new T.PlaneGeometry(1.5, 0.37), new T.MeshBasicMaterial({ map: hoodLogo, toneMapped: false })); logo.position.set(0, 1.05, -L.len - 0.29); S.add(logo);
      const deckLight = new T.PointLight(0xfff1e0, 2.5, 3, 2); deckLight.userData.decor = true; deckLight.position.set(0, 0.9, -L.len - 0.4); S.add(deckLight);
      // ---------------------------------------------------------------- quilles
      const pinTex = G3.canvasTex(T, 256, 256, (g, w, h) => { g.fillStyle = "#f6f4ef"; g.fillRect(0, 0, w, h); g.fillStyle = "#c8102e"; g.fillRect(0, h * 0.22, w, h * 0.035); g.fillRect(0, h * 0.28, w, h * 0.035); });
      const prof = [[0, 0], [0.026, 0], [0.04, 0.02], [0.056, 0.07], [0.0605, 0.115], [0.056, 0.16], [0.042, 0.215], [0.026, 0.26], [0.0215, 0.29], [0.026, 0.33], [0.03, 0.355], [0.026, 0.373], [0.012, 0.381], [0, 0.381]].map(([r, y]) => new T.Vector2(r, y));
      const pinG = new T.LatheGeometry(prof, 28); { const uv = pinG.attributes.uv, p = pinG.attributes.position; for (let i = 0; i < p.count; i++) uv.setY(i, 1 - p.getY(i) / PIN_H); }
      const pinM = new T.MeshPhysicalMaterial({ map: pinTex, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 });
      const pinMeshes = B.PINS.map(() => { const m = new T.Mesh(pinG, pinM); m.castShadow = true; S.add(m); return m; });
      // ---------------------------------------------------------------- boules
      const ballMat = (c) => new T.MeshPhysicalMaterial({ map: G3.canvasTex(T, 512, 256, (g, w, h) => { g.fillStyle = c[0]; g.fillRect(0, 0, w, h);
        for (let k = 0; k < 14; k++) { g.strokeStyle = k % 2 ? c[1] : "rgba(255,255,255,0.25)"; g.globalAlpha = 0.5; g.lineWidth = 6 + Math.random() * 18; g.beginPath(); g.moveTo(0, Math.random() * h); g.bezierCurveTo(w * 0.3, Math.random() * h, w * 0.6, Math.random() * h, w, Math.random() * h); g.stroke(); } g.globalAlpha = 1;
        g.fillStyle = "#0a0a0a"; [[0.48, 0.3], [0.54, 0.3], [0.51, 0.42]].forEach(([x, y]) => { g.beginPath(); g.arc(x * w, y * h, 9, 0, 7); g.fill(); }); }), roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 });
      const balls = P.map((_, i) => ballMat(BALLC[i % BALLC.length]));
      const ballMesh = new T.Mesh(new T.SphereGeometry(L.ball, 40, 28), balls[0]); ballMesh.castShadow = true; S.add(ballMesh);
      const trail = G3.trail(S, { color: 0xff3d63, len: 24, width: L.ball * 0.8, y: 0.01, max: 9 });
      // guide de placement
      const guide = new T.Mesh(new T.PlaneGeometry(0.03, 6), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false })); guide.rotation.x = -Math.PI / 2; guide.position.set(0, 0.004, -3); S.add(guide);
      // ---------------------------------------------------------------- HUD
      api.hud.innerHTML = `<div class="bw-sheet" id="bw-sheet"></div><div class="bw-hint" id="bw-hint">Glisse à gauche ou à droite pour te placer, puis vers le haut pour lancer</div><div class="bw-ban" id="bw-ban" hidden></div>`;
      const $ = (s) => api.hud.querySelector(s);
      const rolls = P.map(() => []), MAXF = Math.max(1, Math.min(10, +o.frames || 10));
      const doneP = (r) => { const c = B.cursor(r); return c.done || (MAXF < 10 && c.frame >= MAXF); };   // partie courte : on s'arrête après MAXF frames
      let cur = 0, phase = "aim", x0 = 0.12, standing = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], pins = B.rack(standing), ball = null, simT = 0, settleT = 0, alive = true, rollSnd = 0, hits = 0;
      /** total : en partie courte, les frames sans bonus encore connu comptent leurs quilles */
      const totalOf = (r) => { const sc = B.score(r); if (MAXF >= 10) return sc.total; let t = 0; sc.frames.slice(0, MAXF).forEach((f) => { t = f.score != null ? f.score : t + f.rolls.reduce((a, b) => a + b, 0); }); return t; };
      const sheet = () => { $("#bw-sheet").innerHTML = P.map((p, i) => { const sc = B.score(rolls[i]), lab = B.label(rolls[i]); let k = 0;
          const fr = sc.frames.slice(0, MAXF).map((f, fi) => { const n = f.rolls.length, sy = lab.slice(k, k + n); k += n; return `<i><span>${sy.map((x) => `<em>${x}</em>`).join("")}</span><b>${f.score == null ? "" : f.score}</b></i>`; }).join("");
          return `<div class="bw-row${i === cur && phase !== "over" ? " on" : ""}"${MAXF < 10 ? ` style="grid-template-columns:42px repeat(${MAXF},1fr) 34px"` : ""}><small>${esc(p.name)}</small>${fr}<strong>${totalOf(rolls[i])}</strong></div>`; }).join("");
        api.turn(phase === "over" ? "" : P[cur].human ? (setup.mode === "bots" ? "À toi" : P[cur].name) : P[cur].name + "…", cur); };
      const banner = (img, txt) => { const b = $("#bw-ban"); b.hidden = false; b.innerHTML = `${img ? `<img src="${img}" alt="">` : ""}<b>${esc(txt)}</b>`; b.classList.remove("in"); void b.offsetWidth; b.classList.add("in"); clearTimeout(b._t); b._t = setTimeout(() => (b.hidden = true), 1500); };
      const syncPins = () => pins.forEach((p) => { const m = pinMeshes[p.i]; m.visible = !p.gone; const f = new T.Vector3(Math.sin(p.dir), 0, -Math.cos(p.dir)), ax = new T.Vector3(f.z, 0, -f.x).normalize();
        m.position.set(p.x, Math.sin(p.tilt) * 0.05, p.z); m.quaternion.setFromAxisAngle(ax.lengthSq() ? ax : new T.Vector3(1, 0, 0), p.tilt); if (p.down) m.rotateY(p.spin); });
      const resetRack = (st) => { standing = st; pins = B.rack(standing); pinMeshes.forEach((m, i) => (m.visible = standing.includes(i))); syncPins(); };
      const newTurn = () => { const c = B.cursor(rolls[cur]); if (c.fresh) resetRack([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        phase = "aim"; ball = null; ballMesh.material = balls[cur]; ballMesh.visible = true; x0 = P[cur].human ? x0 : 0; trail.clear(); sheet(); $("#bw-hint").hidden = !P[cur].human; guide.visible = P[cur].human;
        if (!P[cur].human) setTimeout(() => { if (!alive || phase !== "aim") return; const t = B.botThrow(standing, P[cur].level || "normal"); x0 = t.x0; setTimeout(() => alive && phase === "aim" && throwBall(t.x0, t.angle, t.speed, t.hook), 650); }, 500); };
      const throwBall = (bx, angle, speed, hook) => { api.clip.begin("boule"); ball = B.throwBall(bx, angle, speed, hook); phase = "roll"; simT = 0; settleT = 0; hits = 0; guide.visible = false; $("#bw-hint").hidden = true;
        api.sfx("bowl.roll", { vol: 0.7, intensity: speed / 10 }); rollSnd = 0; api.vibrate(15); };
      const afterRoll = () => {
        const knocked = pins.filter((p) => p.down || p.gone).map((p) => p.i), n = knocked.length, c0 = B.cursor(rolls[cur]);
        rolls[cur].push(n); standing = standing.filter((i) => !knocked.includes(i));
        { const lbl = c0.fresh && n === 10 ? ["STRIKE !", 120] : !c0.fresh && n === c0.standing ? ["SPARE !", 80] : n === 0 && ball && ball.gutter ? ["GOUTTIÈRE", 22] : n >= 8 ? [n + " QUILLES", n * 4] : null;
          if (lbl) api.clip.end({ score: lbl[1], label: lbl[0], sub: P[cur].name }, 350); else api.clip.cancel(); }
        if (c0.fresh && n === 10) { banner("img/games/bowling/fx_strike.webp", "STRIKE !"); api.sfx("bowl.strike"); api.vibrate([30, 40, 80]); S.shake(0.03, 0.4); }
        else if (!c0.fresh && n === c0.standing) { banner("img/games/bowling/fx_spare.webp", "SPARE !"); api.sfx("bowl.strike", { vol: 0.7 }); }
        else if (n === 0) banner(null, ball && ball.gutter ? "Gouttière" : "Raté");
        else banner(null, n + (n > 1 ? " quilles" : " quille"));
        const c = B.cursor(rolls[cur]);
        phase = "wait"; sheet();
        setTimeout(() => { if (!alive) return;
          if (c.done || c.frame > c0.frame) { const nxt = P.findIndex((_, k) => !doneP(rolls[(cur + 1 + k) % P.length])); if (nxt < 0) return finish(); cur = (cur + 1 + nxt) % P.length; resetRack([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); }
          else if (c.fresh) resetRack([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
          else resetRack(standing);
          newTurn(); }, 1400);
      };
      const finish = () => { phase = "over"; sheet(); const tot = P.map((_, i) => totalOf(rolls[i])), best = Math.max(...tot), win = tot.filter((v) => v === best).length > 1 ? null : tot.indexOf(best); const me = Math.max(0, P.findIndex((p) => p.human));
        api.end(win, `Score : ${tot[me]}` + (P.length > 1 ? " · " + P.map((p, i) => p.name + " " + tot[i]).join(", ") : "")); };
      // ---------------------------------------------------------------- geste
      const cv = S.renderer.domElement; let pts = null;
      cv.addEventListener("pointerdown", (e) => { if (phase !== "aim" || !P[cur].human) return; api.clip.begin("boule"); pts = [{ x: e.clientX, y: e.clientY, t: performance.now(), x0 }]; });
      cv.addEventListener("pointermove", (e) => { if (!pts) return; pts.push({ x: e.clientX, y: e.clientY, t: performance.now() }); const a = pts[0], dy = e.clientY - a.y, dx = e.clientX - a.x;
        if (dy > -30) x0 = Math.max(-hw + L.ball, Math.min(hw - L.ball, a.x0 + (dx / cv.clientWidth) * 1.4)); });
      const release = () => { if (!pts) return; const p = pts; pts = null; if (p.length < 3) return; const A = p[0], Z = p[p.length - 1], dy = Z.y - A.y;
        if (dy > -60) return;
        const tail = p.filter((q) => q.t >= Z.t - 120), T0 = tail[0], dt = Math.max(0.03, (Z.t - T0.t) / 1000), vpx = Math.hypot(Z.x - T0.x, Z.y - T0.y) / dt;
        const speed = Math.max(5, Math.min(10.5, 5 + (vpx - 300) / 260)), angle = Math.max(-0.06, Math.min(0.06, Math.atan2(Z.x - A.x, -(dy)) * 0.09));
        const M2 = p[Math.floor(p.length / 2)], lx = Z.x - A.x, ly = Z.y - A.y, ll = Math.hypot(lx, ly) || 1, dev = ((M2.x - A.x) * ly - (M2.y - A.y) * lx) / ll;
        const hook = Math.max(-1, Math.min(1, dev / 45));
        throwBall(x0, angle, speed, hook); };
      cv.addEventListener("pointerup", release); cv.addEventListener("pointercancel", () => (pts = null));
      // ---------------------------------------------------------------- boucle
      const cam = S.camera, look = new T.Vector3(0, 0.2, -8), wantP = new T.Vector3(), wantL = new T.Vector3(), up = new T.Vector3(0, 1, 0), axis = new T.Vector3();
      S.onFrame((dt) => {
        if (phase === "roll" || phase === "settle") {
          const sub = 8, h = Math.min(dt, 0.04) / sub;
          for (let k = 0; k < sub; k++) { const ev = B.step(ball, pins, h); simT += h;
            ev.forEach((e) => { if (e === "gutter") api.sfx("bowl.gutter"); else if (e === "hit" || e === "pin") { hits++; if (hits === 1) api.clip.mark("impact"); if (hits < 8) api.sfx("bowl.pin", { intensity: Math.min(1, 0.4 + hits * 0.1), vol: 0.5 + Math.random() * 0.4 }); } }); }
          const pz = ballMesh.position.z; ballMesh.position.set(ball.x, ball.gutter ? L.ball - 0.07 : L.ball, ball.z); ballMesh.visible = !ball.done;
          const d = Math.abs(ballMesh.position.z - pz); axis.set(ball.vx, 0, ball.vz); if (axis.lengthSq() > 1e-6) { axis.crossVectors(up, axis.normalize()); ballMesh.rotateOnWorldAxis(axis, d / L.ball + (ball.hook * dt * 3)); }
          if (!ball.done) trail.push(ball.x, ball.z, Math.hypot(ball.vx, ball.vz));
          if (!B.moving(ball, pins) || simT > 9) { settleT += dt; if (settleT > 0.5) afterRoll(); }
          syncPins();
        } else if (phase === "aim") { ballMesh.position.set(x0, L.ball, -0.35); guide.position.x = x0; }
        // caméra : derrière la boule, la suit jusqu'aux quilles
        const bz = phase === "roll" || phase === "settle" ? Math.max(ballMesh.position.z, -L.len + 3.4) : 0;
        if (phase === "roll" && ball && !ball.done) { wantP.set(ballMesh.position.x * 0.5, 0.95 + Math.max(0, -bz) * 0.015, bz + 2.6); wantL.set(ballMesh.position.x * 0.3, 0.1, bz - 6); }
        else if (phase === "roll" || phase === "wait") { wantP.set(0, 1.1, -L.len + 3.2); wantL.set(0, 0.15, -L.len - 0.4); }
        else { wantP.set(x0 * 0.4, 1.3, 2.4); wantL.set(x0 * 0.2, 0.15, -9); }
        const k = Math.min(1, dt * (phase === "roll" ? 3.5 : 2.2)); cam.position.lerp(wantP, k); look.lerp(wantL, k); cam.lookAt(look);
      });
      resetRack(standing); newTurn(); api.ambience(theme, theme === "eto" ? "bowl.amb" : theme === "stade" ? "flick.amb" : null, theme === "eto" ? 0.35 : 0.6);
      return { destroy: () => { alive = false; S.dispose(); }, _st: () => ({ cur, phase, rolls: rolls.map((r) => r.slice()), standing: standing.slice(), x0 }), _theme: () => theme,
        _finish: (rs) => { rs.forEach((r, i) => (rolls[i] = r.slice())); finish(); }, _throw: (bx, angle, speed, hook) => { if (phase !== "aim" || !P[cur].human) return false; x0 = bx; throwBall(bx, angle, speed, hook); return true; } };
    },
  });
})();
