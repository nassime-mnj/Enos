"use strict";
// DÉCORS DE FLICK FOOT / HOCKEY : le thème change seulement l'environnement (ciel, sol, lumière, vent, particules), jamais la physique.
//   eto     : arène obsidienne, néons cramoisis, braises qui montent
//   ocean   : plateforme flottante sur un lagon animé (vagues, reflets du soleil, caustiques), îles, voilier, jardinières
//   automne : dalle de pierre en forêt, érables rouges, feuilles qui tombent au vent, rayons de soleil
//   sakura  : jardin japonais (modèle 3D fourni), coucher de soleil, pétales de cerisier au vent
(() => {
  const E = window.ENOS, G3 = E.g3d;
  if (!G3) return;
  const D = (E.flickDecor = {});
  D.THEMES = [["eto", "Arène ETO"], ["stade", "Stade"], ["ocean", "Océan"], ["automne", "Automne"], ["sakura", "Sakura"], ["rue", "Rue"], ["volcan", "Volcan"], ["tempete", "Tempête"]];
  D.IDS = D.THEMES.map((t) => t[0]);
  D.extra = {};          // décors ajoutés par js/games/decor_more.js : D.extra[id](S, m, out, helpers)
  D.surfBase = {};       // fonds de terrain de ces décors : D.surfBase[id](g, w, h)
  const rnd = (a, b) => a + Math.random() * (b - a);

  /** surface du terrain (gazon rayé + lignes, ou glace) */
  D.surface = (T, theme, m, ice) => {
    const hw = m.W / 2, hl = m.L / 2, gh = m.goal / 2, eto = theme === "eto";
    const LINE = { eto: "#ff3d63", ocean: "#f4f1e8", automne: "#f1e2bf", sakura: "#f7e4e8", stade: "#ffffff", rue: "#f2f2ee", volcan: "#ffcf8a", tempete: "#f6d34a" }[theme] || "#ffffff";
    const glowLine = eto || theme === "volcan";
    return G3.canvasTex(T, 1024, Math.round(1024 * m.L / m.W), (g, w, h) => {
      if (ice) { const lg = g.createLinearGradient(0, 0, w, h); lg.addColorStop(0, "#e4ecf3"); lg.addColorStop(1, "#c9d6e1"); g.fillStyle = lg; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 320; i++) { g.strokeStyle = `rgba(255,255,255,${Math.random() * 0.4})`; g.lineWidth = Math.random() * 1.6; g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 140, y + (Math.random() - 0.5) * 40); g.stroke(); } }
      else if (D.surfBase[theme]) D.surfBase[theme](g, w, h);
      else {
        const A = eto ? ["#0d1f15", "#112619"] : theme === "automne" ? ["#2c6a2e", "#347838"] : theme === "sakura" ? ["#3c6b2c", "#447834"] : ["#2b7f3c", "#349146"];
        for (let i = 0; i < 14; i++) { g.fillStyle = A[i % 2]; g.fillRect(0, (i / 14) * h, w, h / 14 + 1); }
        for (let i = 0; i < 26000; i++) { const v = Math.random(); g.fillStyle = v < 0.5 ? `rgba(0,0,0,${Math.random() * (eto ? 0.14 : 0.1)})` : `rgba(190,255,160,${Math.random() * (eto ? 0.03 : 0.06)})`; g.fillRect(Math.random() * w, Math.random() * h, 1.2, 2.6 + Math.random() * 2); }
        if (!eto) { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, h * 0.7); r.addColorStop(0, "rgba(255,255,220,0.06)"); r.addColorStop(1, "rgba(0,0,0,0.22)"); g.fillStyle = r; g.fillRect(0, 0, w, h); }
      }
      const sx = w / m.W, X = (x) => (x + hw) * sx, Z = (z) => (z + hl) * sx;
      const line = (c, wdt) => { g.strokeStyle = c; g.lineWidth = wdt; g.shadowColor = c; g.shadowBlur = glowLine && !ice ? 14 : 0; g.globalAlpha = glowLine || theme === "stade" ? 1 : 0.88; };
      if (ice) { line("#ef1748", 10); g.beginPath(); g.moveTo(0, Z(0)); g.lineTo(w, Z(0)); g.stroke(); line("#1aa3d6", 9); [-m.L * 0.2, m.L * 0.2].forEach((z) => { g.beginPath(); g.moveTo(0, Z(z)); g.lineTo(w, Z(z)); g.stroke(); });
        line("#ef1748", 5); [-1, 1].forEach((sgn) => { g.beginPath(); g.moveTo(0, Z(sgn * (hl - 0.5))); g.lineTo(w, Z(sgn * (hl - 0.5))); g.stroke(); g.beginPath(); g.arc(X(0), Z(sgn * (hl - 0.5)), gh * sx, sgn > 0 ? Math.PI : 0, sgn > 0 ? Math.PI * 2 : Math.PI); g.fillStyle = "rgba(26,163,214,0.25)"; g.fill(); g.stroke(); });
        line("#1aa3d6", 6); g.beginPath(); g.arc(X(0), Z(0), 1.0 * sx, 0, Math.PI * 2); g.stroke(); }
      else { line(LINE, eto ? 7 : 6); g.strokeRect(8, 8, w - 16, h - 16); g.beginPath(); g.moveTo(0, Z(0)); g.lineTo(w, Z(0)); g.stroke(); g.beginPath(); g.arc(X(0), Z(0), 1.1 * sx, 0, Math.PI * 2); g.stroke();
        g.fillStyle = LINE; g.beginPath(); g.arc(X(0), Z(0), 8, 0, Math.PI * 2); g.fill();
        [-1, 1].forEach((sgn) => { const zz = Z(sgn * hl), bw = 3.4 * sx, bd = 1.5 * sx, sw = 1.9 * sx, sd = 0.55 * sx; g.strokeRect(X(0) - bw / 2, sgn < 0 ? zz : zz - bd, bw, bd); g.strokeRect(X(0) - sw / 2, sgn < 0 ? zz : zz - sd, sw, sd);
          g.beginPath(); g.arc(X(0), Z(sgn * (hl - 1.5)), 0.7 * sx, sgn < 0 ? 0.2 : Math.PI + 0.2, sgn < 0 ? Math.PI - 0.2 : Math.PI * 2 - 0.2); g.stroke(); }); }
      g.globalAlpha = 1;
    });
  };

  // ------------------------------------------------------------------ textures communes
  const skyTex = (T, stops, sun, clouds) => G3.canvasTex(T, 1024, 512, (g, w, h) => {
    const lg = g.createLinearGradient(0, 0, 0, h); stops.forEach(([k, c]) => lg.addColorStop(k, c)); g.fillStyle = lg; g.fillRect(0, 0, w, h);
    if (sun) { const r = g.createRadialGradient(sun[0] * w, sun[1] * h, 0, sun[0] * w, sun[1] * h, h * 0.55); r.addColorStop(0, sun[2]); r.addColorStop(0.08, sun[2]); r.addColorStop(0.2, sun[3]); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(0, 0, w, h); }
    for (let k = 0; k < (clouds || 0); k++) { const x = Math.random() * w, y = h * rnd(0.12, 0.42), rw = rnd(60, 180); for (let j = 0; j < 7; j++) { const q = g.createRadialGradient(x + j * rw * 0.18, y + rnd(-8, 8), 0, x + j * rw * 0.18, y, rw * 0.32); q.addColorStop(0, "rgba(255,255,255,0.55)"); q.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = q; g.fillRect(x - rw, y - rw, rw * 3, rw * 2); } }
  });
  const leafTex = (T, kind) => G3.canvasTex(T, 128, 128, (g, w) => {
    g.translate(w / 2, w / 2); g.fillStyle = "#fff";
    if (kind === "petal") { g.beginPath(); g.moveTo(0, -46); g.bezierCurveTo(40, -40, 34, 30, 0, 50); g.bezierCurveTo(-34, 30, -40, -40, 0, -46); g.fill(); g.fillStyle = "rgba(0,0,0,0.12)"; g.beginPath(); g.moveTo(-4, -40); g.lineTo(4, -40); g.lineTo(0, -28); g.fill(); }
    else if (kind === "maple") { g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.62; g.lineTo(Math.cos(a) * 54, Math.sin(a) * 54); g.lineTo(Math.cos(a + 0.31) * 22, Math.sin(a + 0.31) * 22); } g.lineTo(0, 30); g.closePath(); g.fill(); g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 50); g.lineTo(0, -40); g.stroke(); }
    else if (kind === "ember") { const r = g.createRadialGradient(0, 0, 0, 0, 0, 60); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,120,140,0.9)"); r.addColorStop(1, "rgba(255,0,60,0)"); g.fillStyle = r; g.fillRect(-64, -64, 128, 128); }
    else { const r = g.createRadialGradient(0, 0, 0, 0, 0, 60); r.addColorStop(0, "rgba(255,255,255,0.9)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(-64, -64, 128, 128); }
  });
  const rockTex = (T, base, spots) => G3.canvasTex(T, 1024, 1024, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const r = rnd(4, 40); g.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,255,255"},${rnd(0.02, 0.07)})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2); g.fill(); }
    (spots || []).forEach(([c, n, s]) => { for (let i = 0; i < n; i++) { g.fillStyle = c; g.globalAlpha = rnd(0.3, 0.8); g.beginPath(); g.arc(Math.random() * w, Math.random() * h, rnd(s * 0.4, s), 0, Math.PI * 2); g.fill(); } g.globalAlpha = 1; });
    g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 3; for (let i = 0; i < 40; i++) { g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += rnd(-60, 60); y += rnd(-60, 60); g.lineTo(x, y); } g.stroke(); } });
  const lights = (S, o) => { S.key.color.set(o.key); S.key.intensity = o.ki; S.key.position.set(...o.kp); S.rim.intensity = o.rim || 0; S.scene.children.forEach((c) => { if (c.isPointLight && c !== S.rim && !c.userData.decor) c.intensity = o.rim2 || 0; if (c.isHemisphereLight) { c.color.set(o.sky); c.groundColor.set(o.ground); c.intensity = o.hi; } }); };
  const sky = (S, tex, fogColor, fog) => { const T = S.T; const dome = new T.Mesh(new T.SphereGeometry(90, 48, 24), new T.MeshBasicMaterial({ map: tex, side: T.BackSide, fog: false, toneMapped: false })); S.add(dome); S.scene.background = new T.Color(fogColor); S.scene.fog = new T.FogExp2(fogColor, fog); return dome; };

  /** tropique : îlots au loin, végétation */
  const island = (T, x, z, r, hgt, M) => { const g = new T.Group(); const geo = new T.IcosahedronGeometry(1, 4), p = geo.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) { const v = new T.Vector3().fromBufferAttribute(p, i); const n = 1 + Math.sin(v.x * 3.1 + x) * 0.12 + Math.sin(v.z * 4.3 + z) * 0.1 + Math.sin(v.y * 5.7) * 0.06; v.multiplyScalar(n); v.y = Math.max(-0.2, v.y); p.setXYZ(i, v.x * r, v.y * hgt, v.z * r);
      const k = v.y; const c = k < 0.05 ? [0.86, 0.78, 0.58] : k < 0.35 ? [0.16, 0.42, 0.18] : k < 0.7 ? [0.22, 0.36, 0.2] : [0.45, 0.42, 0.38]; col.push(...c); }
    geo.setAttribute("color", new T.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
    const m = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })); m.position.set(x, -0.6, z); g.add(m); return g; };
  const palmPlanter = (T, x, z, M, leafM, flowerM) => { const g = new T.Group(); const pot = new T.Mesh(G3.roundedBox(T, 0.9, 0.5, 0.9, 0.12, 2), M.metal); pot.position.y = 0.25; g.add(pot);
    const soil = new T.Mesh(new T.BoxGeometry(0.78, 0.04, 0.78), new T.MeshStandardMaterial({ color: 0x2b1d12, roughness: 1 })); soil.position.y = 0.5; g.add(soil);
    for (let i = 0; i < 9; i++) { const l = new T.Mesh(new T.PlaneGeometry(0.22, 0.9), leafM); const a = (i / 9) * Math.PI * 2; l.position.set(Math.cos(a) * 0.22, 0.85, Math.sin(a) * 0.22); l.rotation.set(-0.9 + Math.random() * 0.3, -a + Math.PI / 2, 0, "YXZ"); l.userData.sway = Math.random() * 6; g.add(l); }
    for (let i = 0; i < 6; i++) { const f = new T.Mesh(new T.IcosahedronGeometry(0.09, 1), flowerM); f.position.set(rnd(-0.3, 0.3), 0.62 + Math.random() * 0.25, rnd(-0.3, 0.3)); g.add(f); }
    g.position.set(x, 0, z); return g; };
  /** arbre « nuage » (érable, cerisier) : tronc + grappes facettées */
  const cloudTree = (T, x, z, h, colors, trunkM) => { const g = new T.Group(); const tr = new T.Mesh(new T.CylinderGeometry(0.16, 0.3, h * 0.6, 8), trunkM); tr.position.y = h * 0.3; tr.castShadow = true; g.add(tr);
    for (let i = 0; i < 9; i++) { const c = new T.Mesh(new T.IcosahedronGeometry(rnd(0.7, 1.3) * h * 0.22, 1), new T.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.85, flatShading: true }));
      c.position.set(rnd(-0.9, 0.9) * h * 0.25, h * rnd(0.62, 0.95), rnd(-0.9, 0.9) * h * 0.25); c.castShadow = true; c.userData.sway = Math.random() * 6; g.add(c); }
    g.position.set(x, 0, z); return g; };

  /**
   * construit le décor ; renvoie {update(dt, t), gust(k), hideGoals, hideSurface, rail: {mat, cap}, ready: Promise}
   * pad = marge autour du terrain (bandes)
   */
  D.build = (S, theme, m, ice) => {
    const T = S.T, M = S.mats, hw = m.W / 2, hl = m.L / 2, upd = [], parts = [];
    const out = { hideGoals: false, hideSurface: false, update: (dt, t) => { upd.forEach((f) => f(dt, t)); parts.forEach((p) => p.update(dt)); }, gust: (k) => parts.forEach((p) => (p.gust = Math.max(p.gust, k))), ready: Promise.resolve(), goalM: M.metal, netColor: 0xffffff };
    if (D.extra[theme]) { D.extra[theme](S, m, out, { skyTex, leafTex, rockTex, lights, sky, cloudTree, island, upd, parts, rnd }); return out; }
    if (theme === "ocean") {
      sky(S, skyTex(T, [[0, "#2f7fd3"], [0.55, "#8fd0f2"], [1, "#e7f6ff"]], [0.78, 0.18, "rgba(255,252,235,1)", "rgba(255,236,190,0.6)"], 10), 0x9fd8ee, 0.006);
      lights(S, { key: 0xfff4e0, ki: 2.8, kp: [6, 12, -8], sky: 0xbfe6ff, ground: 0x2a6f6a, hi: 1.0 });
      S.renderer.toneMappingExposure = 1.1;
      // lagon animé
      const water = new T.ShaderMaterial({ fog: false, uniforms: { uTime: { value: 0 }, uSun: { value: new T.Vector3(0.45, 0.6, -0.65).normalize() }, uDeep: { value: new T.Color("#04607e") }, uShallow: { value: new T.Color("#33d3c6") }, uSky: { value: new T.Color("#bfe9ff") }, uHalf: { value: new T.Vector2(hw + 1.6, hl + 1.6) } },
        vertexShader: `uniform float uTime; varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); w.y += sin(w.x*0.35+uTime*1.1)*0.06 + sin(w.z*0.5-uTime*1.4)*0.05; vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform float uTime; uniform vec3 uSun, uDeep, uShallow, uSky; uniform vec2 uHalf; varying vec3 vW;
          float hgt(vec2 p){ return sin(p.x*0.35+uTime*1.1)*0.06 + sin(p.y*0.5-uTime*1.4)*0.05 + sin((p.x+p.y)*0.9+uTime*1.6)*0.02 + sin((p.x*0.7-p.y*1.1)+uTime*1.2)*0.015; }
          void main(){ vec2 p = vW.xz; float e = 0.06; vec3 n = normalize(vec3(hgt(p-vec2(e,0.0))-hgt(p+vec2(e,0.0)), 2.0*e, hgt(p-vec2(0.0,e))-hgt(p+vec2(0.0,e))));
            vec3 v = normalize(cameraPosition - vW); float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
            float d = length(max(abs(p) - uHalf, 0.0)); float sh = exp(-d * 0.28);
            vec3 base = mix(uDeep, uShallow, sh);
            float c = sin(p.x*3.6 + uTime*1.5 + sin(p.y*2.8 + uTime)) * sin(p.y*3.9 - uTime*1.2 + sin(p.x*2.5));
            base += vec3(0.7, 1.0, 0.95) * pow(max(c, 0.0), 5.0) * 0.45 * sh;
            vec3 col = mix(base, uSky, fres * 0.55);
            vec3 r = reflect(-v, n); col += vec3(1.0, 0.96, 0.85) * pow(max(dot(r, uSun), 0.0), 60.0) * 1.2;
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }` });
      const wm = new T.Mesh(new T.PlaneGeometry(220, 220, 160, 160), water); wm.rotation.x = -Math.PI / 2; wm.position.y = -0.75; S.add(wm);
      upd.push((dt, t) => (water.uniforms.uTime.value = t));
      // plateforme flottante (coque chromée, liseré lumineux, pont en bois)
      const pw = m.W + 2.3, pl = m.L + 2.3;
      const hull = new T.Mesh(G3.roundedBox(T, pw, 0.9, pl, 0.7, 4), new T.MeshPhysicalMaterial({ color: 0xe9eef2, roughness: 0.18, metalness: 0.75, clearcoat: 1 })); hull.position.y = -0.5; hull.castShadow = true; hull.receiveShadow = true; S.add(hull);
      const deck = new T.Mesh(G3.roundedBox(T, pw - 0.15, 0.08, pl - 0.15, 0.6, 2), new T.MeshStandardMaterial({ map: G3.canvasTex(T, 512, 512, (g, w, h) => { for (let i = 0; i < 24; i++) { g.fillStyle = i % 2 ? "#7b4f2c" : "#8a5a33"; g.fillRect(0, (i / 24) * h, w, h / 24); } for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`; g.fillRect(Math.random() * w, Math.random() * h, 8, 1); } }), roughness: 0.6 }));
      deck.position.y = -0.075; deck.receiveShadow = true; S.add(deck);
      const dotM = new T.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
      for (let i = 0; i < 40; i++) { const k = i / 40, per = 2 * (pw + pl), d = k * per; let x, z; if (d < pw) { x = -pw / 2 + d; z = pl / 2; } else if (d < pw + pl) { x = pw / 2; z = pl / 2 - (d - pw); } else if (d < 2 * pw + pl) { x = pw / 2 - (d - pw - pl); z = -pl / 2; } else { x = -pw / 2; z = -pl / 2 + (d - 2 * pw - pl); }
        const dt = new T.Mesh(new T.BoxGeometry(0.18, 0.05, 0.05), dotM); dt.position.set(x * 1.002, -0.45, z * 1.002); dt.rotation.y = Math.abs(z) > pl / 2 - 0.01 ? 0 : Math.PI / 2; S.add(dt); }
      // jardinières aux coins et sur les côtés
      const leafM = new T.MeshStandardMaterial({ color: 0x2e8b3d, roughness: 0.6, side: T.DoubleSide }), flowerM = new T.MeshStandardMaterial({ color: 0xff4a3a, roughness: 0.5, emissive: 0x401008 });
      const planters = [[-pw / 2 + 0.55, -pl / 2 + 0.55], [pw / 2 - 0.55, -pl / 2 + 0.55], [-pw / 2 + 0.55, pl / 2 - 0.55], [pw / 2 - 0.55, pl / 2 - 0.55], [-pw / 2 + 0.5, 0], [pw / 2 - 0.5, 0]].map(([x, z]) => { const p = palmPlanter(T, x, z, M, leafM, flowerM); S.add(p); return p; });
      upd.push((dt, t) => planters.forEach((p) => p.children.forEach((c) => { if (c.userData.sway != null) c.rotation.z = Math.sin(t * 1.6 + c.userData.sway) * 0.12 * (1 + parts[0].gust); })));
      // îles, voilier, coraux sous l'eau près de la plateforme
      [[-14, -26, 7, 4.5], [10, -30, 9, 5.5], [24, -18, 5, 3], [-26, -12, 6, 3.5]].forEach(([x, z, r, h]) => S.add(island(T, x, z, r, h, M)));
      const boat = new T.Group(); const hullB = new T.Mesh(new T.CylinderGeometry(0.2, 0.5, 2.2, 6, 1), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })); hullB.rotation.z = Math.PI / 2; hullB.scale.set(1, 1, 0.5); boat.add(hullB);
      const sail = new T.Mesh(new T.ConeGeometry(0.9, 2.8, 3, 1, true), new T.MeshStandardMaterial({ color: 0xfdfdf8, side: T.DoubleSide, roughness: 0.7 })); sail.position.y = 1.5; sail.scale.z = 0.08; boat.add(sail); boat.position.set(-9, -0.55, -20); S.add(boat);
      upd.push((dt, t) => { boat.position.y = -0.55 + Math.sin(t * 1.2) * 0.08; boat.rotation.z = Math.sin(t * 0.9) * 0.05; boat.position.x = -9 + Math.sin(t * 0.03) * 3; });
      // embruns / scintillements au vent
      parts.push(G3.particles(S, { count: 26, tex: leafTex(T, "spark"), colors: ["#fff6dc"], size: [0.04, 0.08], area: [-hw - 8, hw + 8, -hl - 10, hl + 4], y: [-0.5, 1.2], fall: -0.05, wind: { x: 1.6, z: 0.2 }, additive: true }));
    } else if (theme === "automne") {
      // terrain en lévitation au-dessus d'une mer de nuages, îles flottantes aux érables
      sky(S, skyTex(T, [[0, "#6fb2e8"], [0.45, "#bfe0f6"], [0.8, "#fff4e2"], [1, "#ffffff"]], [0.8, 0.55, "rgba(255,250,235,1)", "rgba(255,226,170,0.55)"], 0), 0xdfeaf3, 0.006);
      lights(S, { key: 0xffe2b8, ki: 3.1, kp: [7, 12, -6], sky: 0xdcefff, ground: 0xfff1de, hi: 1.1 });
      S.renderer.toneMappingExposure = 0.98;
      const cols = ["#d9441c", "#ee7a22", "#b8281a", "#f6a531", "#e3591f"], trunkM = new T.MeshStandardMaterial({ color: 0x4a2f22, roughness: 0.9 });
      const grassM = new T.MeshStandardMaterial({ color: 0x3f9a3a, roughness: 0.85 }), rockM = new T.MeshStandardMaterial({ map: rockTex(T, "#8b7c6e", [["#6f6257", 80, 30]]), roughness: 0.9, flatShading: true });
      // dessous rocheux (cône inversé déchiqueté)
      const underside = (r, depth, seed) => { const g = new T.ConeGeometry(r, depth, 14, 4, true), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < depth / 2 - 0.01) { const k = 1 + Math.sin(i * 1.7 + seed) * 0.12; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); p.setY(i, y + Math.sin(i * 2.3 + seed) * depth * 0.06); } } g.computeVertexNormals(); g.rotateX(Math.PI); return g; };
      // le terrain flottant : dalle d'herbe + roche dessous
      const pw = m.W + 2.6, pl = m.L + 2.6;
      const top = new T.Mesh(G3.roundedBox(T, pw, 0.5, pl, 0.6, 3), grassM); top.position.y = -0.27; top.receiveShadow = true; S.add(top);
      const under = new T.Mesh(underside(1, 1, 3), rockM); under.scale.set(pw * 0.62, 5.5, pl * 0.62); under.position.y = -0.52 - 2.75; S.add(under);
      // îles flottantes
      const isles = [];
      const isle = (x, y, z, r, nTrees) => { const g = new T.Group(); const t = new T.Mesh(new T.CylinderGeometry(r, r * 0.92, 0.45, 28), grassM); t.receiveShadow = true; g.add(t);
        const u = new T.Mesh(underside(r * 0.95, r * 1.8, x), rockM); u.position.y = -0.22 - r * 0.9; g.add(u);
        for (let i = 0; i < nTrees; i++) { const a = rnd(0, 6.28), d = rnd(0, r * 0.6); const tr = cloudTree(T, Math.cos(a) * d, Math.sin(a) * d, rnd(1.8, 3.2), cols, trunkM); tr.position.y = 0.22; g.add(tr); }
        g.position.set(x, y, z); g.userData = { y, ph: rnd(0, 6) }; S.add(g); isles.push(g); return g; };
      isle(-6.4, -1.4, -9, 2.2, 3); isle(6.8, -0.6, -11, 2.6, 4); isle(-2, -3.2, -15, 1.6, 2); isle(9, -2.6, -3, 1.8, 2); isle(-8.6, -2.2, 2, 1.7, 2); isle(3.2, -4, -17, 2.4, 3);
      // arbres en bord de terrain
      [[-hw - 1.0, -hl - 0.9, 2.6], [hw + 1.0, -hl - 0.9, 3], [-hw - 1.0, hl + 0.9, 2.2], [hw + 1.0, hl + 0.9, 2.4]].forEach(([x, z, h]) => { const tr = cloudTree(T, x, z, h, cols, trunkM); tr.position.y = -0.02; S.add(tr); isles.push(tr); });
      upd.push((dt, t) => isles.forEach((g) => { if (g.userData.y != null) g.position.y = g.userData.y + Math.sin(t * 0.5 + g.userData.ph) * 0.18;
        g.traverse((c) => { if (c.userData.sway != null) c.rotation.z = Math.sin(t * 1.1 + c.userData.sway) * 0.05 * (1 + parts[0].gust * 2); }); }));
      // mer de nuages : grands puffs blancs doux en dessous, qui dérivent
      const puffT = G3.canvasTex(T, 256, 256, (g, w) => { for (let i = 0; i < 9; i++) { const x = w / 2 + rnd(-60, 60), y = w / 2 + rnd(-30, 30), r = rnd(50, 100); const q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, "rgba(255,255,255,0.95)"); q.addColorStop(0.6, "rgba(255,255,255,0.45)"); q.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = q; g.fillRect(0, 0, w, w); } });
      const NC = G3.fx() ? 90 : 40, cl = new T.InstancedMesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: puffT, transparent: true, depthWrite: false, fog: false, color: 0xe8eef4 }), NC), cd = new T.Object3D(), C = [];
      for (let i = 0; i < NC; i++) C.push({ x: rnd(-34, 34), y: rnd(-9, -4.5), z: rnd(-44, 22), s: rnd(7, 16), v: rnd(0.15, 0.4) });
      cl.frustumCulled = false; S.add(cl);
      const floor = new T.Mesh(new T.PlaneGeometry(240, 240), new T.MeshBasicMaterial({ color: 0xd9e4ee, fog: false })); floor.rotation.x = -Math.PI / 2; floor.position.y = -10; S.add(floor);
      upd.push((dt) => { C.forEach((c, i) => { c.x += c.v * dt; if (c.x > 36) c.x = -36; cd.position.set(c.x, c.y, c.z); cd.rotation.set(-Math.PI / 2, 0, 0); cd.scale.set(c.s * 1.6, c.s, 1); cd.updateMatrix(); cl.setMatrixAt(i, cd.matrix); }); cl.instanceMatrix.needsUpdate = true; });
      // feuilles qui tombent (et se posent sur le terrain)
      parts.push(G3.particles(S, { count: 80, tex: leafTex(T, "maple"), colors: cols, size: [0.2, 0.38], area: [-hw - 4, hw + 4, -hl - 6, hl + 3], y: [0.02, 7], fall: 0.55, wind: { x: 0.9, z: 0.35 }, ground: 0.02, spin: 1.2 }));
      out.goalM = M.gold;
    } else if (theme === "sakura") {
      sky(S, skyTex(T, [[0, "#2c1638"], [0.45, "#c2557a"], [0.8, "#f6a463"], [1, "#ffd9a0"]], [0.5, 0.78, "rgba(255,236,190,1)", "rgba(255,150,120,0.55)"], 4), 0x6a3048, 0.016);
      lights(S, { key: 0xffc79a, ki: 2.6, kp: [-6, 9, -9], sky: 0xffc0d4, ground: 0x2a1018, hi: 0.85 });
      const ground = new T.Mesh(new T.CircleGeometry(70, 64), new T.MeshStandardMaterial({ map: rockTex(T, "#3a2a24", [["#5a3a2e", 100, 30], ["#2e3a20", 60, 40]]), roughness: 0.9 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -1.2; ground.receiveShadow = true; S.add(ground);
      const trunkM = new T.MeshStandardMaterial({ color: 0x3a2018, roughness: 0.9 }), pinks = ["#f6c1d3", "#f4a7c1", "#fbd6e2", "#e98bab"];
      // collines au loin (silhouettes) plutôt que des arbres procéduraux : les cerisiers sont ceux du modèle
      const hillM = new T.MeshStandardMaterial({ color: 0x3a1d33, roughness: 1, fog: true });
      [[-18, -30, 14, 7], [6, -34, 18, 9], [26, -26, 12, 6], [-32, -18, 10, 5]].forEach(([x, z, r, h]) => { const hm = new T.Mesh(new T.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hillM); hm.scale.set(r, h, r * 0.6); hm.position.set(x, -1.2, z); S.add(hm); });
      [[-hw - 1.6, -hl - 1.6], [hw + 1.6, -hl - 1.6], [-hw - 1.6, hl + 1.6], [hw + 1.6, hl + 1.6]].forEach(([x, z]) => { const l = new T.PointLight(0xffb070, 6, 7, 2); l.userData.decor = true; l.position.set(x, 1.2, z); S.add(l); });
      out.hideGoals = true; out.hideSurface = true; out.netColor = 0xffffff;
      // jardin (modèle 3D) : gazon aligné sur le terrain physique
      out.ready = G3.loadGLB("sakura").then((sc) => {
        if (!sc) { out.hideGoals = false; out.hideSurface = false; return false; }
        // gazon du modèle : x ∈ [-0.622, 0.592], z ∈ [-0.377, 0.431], hauteur -0.15 ; on le tourne pour aligner sa longueur sur z
        const sx = m.L / 1.214, sz = m.W / 0.808, sy = (sx + sz) / 2, cx = (-0.622 + 0.592) / 2, cz = (-0.377 + 0.431) / 2;
        sc.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; if (o.material) { o.material.envMapIntensity = 0.6; } } });
        const holder = new T.Group(); sc.position.set(-cx, 0.15, -cz); sc.scale.set(1, 1, 1); holder.add(sc); holder.scale.set(sx, sy, sz); holder.rotation.y = Math.PI / 2; holder.position.y = -0.012; S.add(holder);
        return true; });
      parts.push(G3.particles(S, { count: 110, tex: leafTex(T, "petal"), colors: pinks, size: [0.1, 0.2], area: [-hw - 5, hw + 5, -hl - 6, hl + 3], y: [0.02, 6], fall: 0.35, wind: { x: 0.8, z: 0.45 }, ground: 0.02, spin: 1.6 }));
    } else {
      G3.backdrop(S, { y: -0.35, glow: 26 });
      parts.push(G3.particles(S, { count: 60, tex: leafTex(T, "ember"), colors: ["#ff3d63", "#ffb0c0", "#e8b54a"], size: [0.05, 0.12], area: [-hw - 3, hw + 3, -hl - 3, hl + 3], y: [-0.3, 6], fall: -0.35, wind: { x: 0.2, z: -0.1 }, additive: true }));
    }
    return out;
  };
})();
