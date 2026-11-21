"use strict";
// MINI-GOLF 3D : parcours de 9 trous (js/games/golf_rules.js), rendu « cartoon » : ombrage toon par paliers, contours noirs (coques inversées),
// couleurs franches, eau stylisée, looping orange, moulin, boulets, bumpers champignons, drapeau qui flotte.
// Tu joues la balle elle-même : caméra derrière la balle ; glisse à gauche / à droite pour viser, tire vers le bas pour doser, relâche pour taper.
// Décors : Lagon, Forêt, Rue, Volcan (la lave remplace l'eau), Tempête (mer d'orage, pluie, éclairs).
(() => {
  const E = window.ENOS, G3 = E.g3d, GF = E.golf, esc = E.esc;
  if (!E.jeux || !G3 || !GF) return;
  const RULES = `<p>Chacun son tour, tape ta balle jusqu'au trou. Le moins de coups gagne.</p>
    <p><b>Viser</b> : glisse le doigt à gauche ou à droite. <b>Doser</b> : tire vers le bas (la jauge à droite monte). <b>Taper</b> : relâche. Remonte le doigt pour annuler.</p>
    <p>Le <b>looping</b> demande de la vitesse : trop doux, la balle redescend. Les bras du <b>moulin</b> et les <b>boulets</b> bougent : choisis ton moment. Tomber à l'eau (ou dans la lave) coûte un coup, la balle revient à sa place.</p>
    <p>7 coups au maximum par trou.</p>`;
  const PCOL = ["#ffffff", "#ff3d63", "#1acfd6", "#e8b54a"];
  const THEMES = [["lagon", "Lagon"], ["foret", "Forêt"], ["rue", "Rue"], ["volcan", "Volcan"], ["tempete", "Tempête"]];
  const TH = {
    lagon: { turf: ["#46d34f", "#3cc244"], top: "#ffd23a", inner: "#1f8fe8", outer: "#1f8fe8", base: "#f3d99c", plank: "#c98a4a", fluid: "lagoon", ol: "#0f2e46",
      sky: [[0, "#3d9cf0"], [0.55, "#9fd6ff"], [1, "#eaf8ff"]], fog: 0xbfe4ff, sun: 0xfff2d8, hemi: [0xcfeaff, 0x7a9a60, 1.2], deep: "#1592d4", shallow: "#38d8de" },
    foret: { turf: ["#62c93d", "#55b834"], top: "#c27f40", inner: "#8f582b", outer: "#7c4a22", base: "#7c4a22", plank: "#a8743f", ground: "#5bb83a", ol: "#1e1a12",
      sky: [[0, "#5fb2f2"], [0.6, "#b9e2ff"], [1, "#f4fbff"]], fog: 0xcfe9ff, sun: 0xfff0d0, hemi: [0xd8eeff, 0x4d7a30, 1.1], deep: "#2a9fd0", shallow: "#58d4e6" },
    rue: { turf: ["#2f9fdc", "#2a8fc8"], top: "#ffffff", inner: "#e8423a", outer: "#e8423a", stripe: "#ffffff", base: "#8c8f96", plank: "#9c7a52", ground: "#4b4d53", ol: "#15161b",
      sky: [[0, "#2a3260"], [0.45, "#7b5a9a"], [0.8, "#f39a68"], [1, "#ffd3a0"]], fog: 0x8a6f8e, sun: 0xffc08a, hemi: [0xb8a8e0, 0x504038, 1.0], deep: "#1d4f6a", shallow: "#2f7a8f" },
    volcan: { turf: ["#3fa868", "#36955c"], top: "#ff8a2a", inner: "#2a2422", outer: "#2a2422", base: "#2a2422", plank: "#5a4032", fluid: "lava", ol: "#0a0606", glowTop: true,
      sky: [[0, "#140606"], [0.45, "#3a0e08"], [0.8, "#7a240c"], [1, "#c24a12"]], fog: 0x3a1208, sun: 0xffc8a0, hemi: [0x8a4a3a, 0xff6a20, 0.9] },
    tempete: { turf: ["#4a8fb0", "#41809e"], top: "#f2c21b", inner: "#2b3036", outer: "#2b3036", stripe: "#f2c21b", base: "#3b4248", plank: "#6a5a48", fluid: "storm", ol: "#05070a",
      sky: null, fog: 0x101820, sun: 0xb8cce8, hemi: [0x5a6a80, 0x0a0e14, 1.0] },
  };
  const EXPRESS = [1, 5, 6];

  E.jeux.register({
    id: "golf", title: "Mini-golf", sub: "Parcours 3D : vise, dose, tape", hero: "img/games/common/card_golf.webp", min: 1, max: 4, rules: RULES,
    icon: '<path d="M7 21V4l9 3.5-9 3.5"/><ellipse cx="12" cy="20" rx="8" ry="2"/>',
    options: [{ key: "holes", label: "Parcours", def: 9, choices: [[9, "9 trous"], [3, "Express · 3 trous"]] },
      { key: "decor", label: "Décor", def: "lagon", choices: THEMES }],
    async start(host, setup, api) {
      const P = setup.players, o = setup.opts || {}, theme = TH[o.decor] ? o.decor : "lagon", C = TH[theme];
      const order = +o.holes === 3 ? EXPRESS : GF.HOLES.map((_, i) => i);
      const S = await G3.stage(host, { fov: 55, exposure: 1.0, fog: 0.01, cam: [0, 3, 4], look: [0, 0, -2], bloom: { strength: theme === "volcan" ? 0.3 : 0.28, radius: 0.45, threshold: theme === "volcan" ? 0.96 : 0.97 } });
      const T = S.T, FX = E.decorFx;
      S.renderer.toneMapping = T.NoToneMapping; S.renderer.shadowMap.type = T.PCFShadowMap;
      // ---------------------------------------------------------------- matériaux toon
      const grad = new T.DataTexture(new Uint8Array([105, 170, 225, 255]), 4, 1, T.RedFormat); grad.minFilter = grad.magFilter = T.NearestFilter; grad.needsUpdate = true;
      const toon = (color, x) => new T.MeshToonMaterial(Object.assign({ color, gradientMap: grad }, x || {}));
      const olM = new T.MeshBasicMaterial({ color: C.ol, side: T.BackSide });
      const olPush = (th) => new T.ShaderMaterial({ side: T.BackSide, uniforms: { c: { value: new T.Color(C.ol) } }, vertexShader: `void main(){ vec3 p = position + normal * ${th.toFixed(3)}; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`, fragmentShader: "uniform vec3 c; void main(){ gl_FragColor = vec4(c, 1.0); }" });
      const OL = olPush(0.022), OLs = olPush(0.012);
      const outline = (mesh, m) => { const h = new T.Mesh(mesh.geometry, m || OL); h.renderOrder = -1; mesh.add(h); return mesh; };
      const tex = (w, h, draw, rep) => { const t = G3.canvasTex(T, w, h, draw); if (rep) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } return t; };
      const grain = (g, w, h, n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${Math.random() * a})` : `rgba(0,0,0,${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2 + Math.random() * 3); } };
      const turfT = tex(256, 256, (g, w) => { [[0, 0, 0], [1, 0, 1], [0, 1, 1], [1, 1, 0]].forEach(([x, y, k]) => { g.fillStyle = C.turf[k]; g.fillRect(x * w / 2, y * w / 2, w / 2, w / 2); }); grain(g, w, w, 5000, 0.07); }, [1, 1]);
      const plankT = tex(128, 256, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? C.plank : new T.Color(C.plank).multiplyScalar(0.85).getStyle(); g.fillRect(0, (i / 8) * h, w, h / 8 - 3); g.fillStyle = "rgba(0,0,0,0.45)"; g.fillRect(0, ((i + 1) / 8) * h - 3, w, 3); } grain(g, w, h, 1500, 0.08); }, [1, 1]);
      const turfM = toon(0xffffff, { map: turfT }), plankM = toon(0xffffff, { map: plankT });
      // ---------------------------------------------------------------- environnement
      const LEVEL = C.fluid ? -0.6 : -0.42, upd = [];
      const skyT = C.sky ? tex(1024, 512, (g, w, h) => { const lg = g.createLinearGradient(0, 0, 0, h); C.sky.forEach(([k, c]) => lg.addColorStop(k, c)); g.fillStyle = lg; g.fillRect(0, 0, w, h);
        if (theme !== "volcan") for (let k = 0; k < 16; k++) { const x = Math.random() * w, y = h * (0.12 + Math.random() * 0.3), r = 24 + Math.random() * 40; for (let j = 0; j < 6; j++) { const cx = x + j * r * 0.7, cy = y - Math.sin(j / 5 * Math.PI) * r * 0.5; g.fillStyle = theme === "rue" ? "rgba(255,210,190,0.75)" : "rgba(255,255,255,0.95)"; g.beginPath(); g.arc(cx, cy, r * (0.7 + Math.sin(j) * 0.2), 0, 7); g.fill(); g.fillStyle = "rgba(160,190,220,0.35)"; g.fillRect(cx - r, cy + r * 0.25, r * 2, r * 0.45); } } }) : null;
      if (skyT) { S.add(new T.Mesh(new T.SphereGeometry(120, 32, 16), new T.MeshBasicMaterial({ map: skyT, side: T.BackSide, fog: false, toneMapped: false }))); }
      S.scene.background = new T.Color(C.fog); S.scene.fog = new T.Fog(C.fog, 30, 110);
      S.key.color.set(C.sun); S.key.intensity = 2.7; S.key.position.set(-6, 14, 5); S.key.shadow.camera.left = S.key.shadow.camera.bottom = -14; S.key.shadow.camera.right = S.key.shadow.camera.top = 14; S.key.shadow.camera.updateProjectionMatrix();
      S.scene.children.forEach((c) => { if (c.isPointLight) c.intensity = 0; if (c.isHemisphereLight) { c.color.set(C.hemi[0]); c.groundColor.set(C.hemi[1]); c.intensity = C.hemi[2]; } });
      S.scene.environment = null;
      const keyT = S.key.target; S.add(keyT);
      const waterMat = (deep, shallow) => new T.ShaderMaterial({ fog: false, uniforms: { uTime: { value: 0 }, uDeep: { value: new T.Color(deep) }, uShallow: { value: new T.Color(shallow) } },
        vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
        fragmentShader: `uniform float uTime; uniform vec3 uDeep, uShallow; varying vec3 vW;
          void main(){ vec2 p = vW.xz; float n = sin(p.x*1.25 + uTime*1.1 + sin(p.y*0.8 + uTime*0.7)) * sin(p.y*1.05 - uTime*0.9 + sin(p.x*0.6 - uTime*0.4));
            vec3 col = mix(uDeep, uShallow, 0.5 + 0.5*sin(p.x*0.12 + p.y*0.09));
            col = mix(col, vec3(1.0), smoothstep(0.80, 0.84, n) * 0.75);
            col = mix(col, uShallow*1.15, smoothstep(0.5, 0.54, n) * 0.25);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }` });
      let storm = null;
      if (C.fluid === "lagoon") { const wm = waterMat(C.deep, C.shallow), w = new T.Mesh(new T.PlaneGeometry(300, 300), wm); w.rotation.x = -Math.PI / 2; w.position.y = LEVEL; S.add(w); upd.push((dt, t) => (wm.uniforms.uTime.value = t)); }
      else if (C.fluid === "lava" && FX) { const lm = FX.lava(T, { scale: 0.2 }), w = new T.Mesh(new T.PlaneGeometry(300, 300, 60, 60), lm); w.rotation.x = -Math.PI / 2; w.position.y = LEVEL; S.add(w); upd.push((dt, t) => (lm.uniforms.uTime.value = t)); }
      else if (C.fluid === "storm" && FX) { const sm = FX.stormSea(T, { amp: 0.7 }), w = new T.Mesh(new T.PlaneGeometry(260, 260, G3.fx() ? 200 : 110, G3.fx() ? 200 : 110), sm); w.rotation.x = -Math.PI / 2; w.position.y = LEVEL - 1.6; S.add(w);
        const skyS = tex(1024, 512, (g, w2, h) => { const lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, "#07090d"); lg.addColorStop(0.6, "#18222e"); lg.addColorStop(1, "#2c3a46"); g.fillStyle = lg; g.fillRect(0, 0, w2, h); for (let k = 0; k < 140; k++) { const x = Math.random() * w2, y = h * Math.random() * 0.7, r = 30 + Math.random() * 90, q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, `rgba(${Math.random() < 0.5 ? "10,13,18" : "50,60,72"},0.4)`); q.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = q; g.fillRect(x - r, y - r, r * 2, r * 2); } });
        const dome = new T.Mesh(new T.SphereGeometry(120, 32, 16), new T.MeshBasicMaterial({ map: skyS, side: T.BackSide, fog: false, toneMapped: false })); S.add(dome);
        const hemi = S.scene.children.find((c) => c.isHemisphereLight), rain = FX.rain(S, { count: 1400, area: 18, h: 18, y0: LEVEL - 1, wind: [3, 1] });
        storm = { rain, bolt: FX.lightning(S, { onStrike: () => api.sfx("flick.post", { vol: 0.25, rate: 0.5 }), onFlash: (k) => { sm.uniforms.uFlash.value = k; if (hemi) hemi.intensity = C.hemi[2] + k * 4; dome.material.color.setScalar(1 + k * 2.5); } }) };
        upd.push((dt, t) => { sm.uniforms.uTime.value = t; storm.bolt.update(dt); storm.rain.update(t, storm.bolt.flash); }); }
      if (C.ground) { const gT = theme === "rue" ? tex(512, 512, (g, w) => { g.fillStyle = C.ground; g.fillRect(0, 0, w, w); grain(g, w, w, 9000, 0.12); g.strokeStyle = "rgba(255,255,255,0.5)"; g.lineWidth = 6; g.setLineDash([40, 30]); g.beginPath(); g.moveTo(0, w / 2); g.lineTo(w, w / 2); g.stroke(); }, [30, 30])
          : tex(256, 256, (g, w) => { g.fillStyle = C.ground; g.fillRect(0, 0, w, w); for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "30,80,20" : "150,220,90"},0.35)`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * w, 2, 6, Math.random(), 0, 7); g.fill(); } }, [60, 60]);
        const gr = new T.Mesh(new T.PlaneGeometry(300, 300), toon(0xffffff, { map: gT })); gr.rotation.x = -Math.PI / 2; gr.position.y = LEVEL + 0.02; gr.receiveShadow = true; S.add(gr); }
      // décor lointain (fixe pour tout le parcours)
      const deco = new T.Group(); S.add(deco);
      const rock = (x, z, s, col) => { const g = new T.IcosahedronGeometry(s, 0), p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.max(-0.2 * s, p.getY(i)) * 0.8); g.computeVertexNormals(); const m = outline(new T.Mesh(g, toon(col || 0x9a9aa2, { flatShading: true })), OLs); m.position.set(x, LEVEL, z); m.rotation.y = Math.random() * 6; m.castShadow = true; deco.add(m); return m; };
      const pine = (x, z, s) => { const g = new T.Group(); const tr = outline(new T.Mesh(new T.CylinderGeometry(0.1 * s, 0.14 * s, 0.6 * s, 8), toon(0x6b4226)), OLs); tr.position.y = 0.3 * s; g.add(tr);
        for (let i = 0; i < 3; i++) { const c = outline(new T.Mesh(new T.ConeGeometry((0.75 - i * 0.18) * s, 0.9 * s, 9), toon(i % 2 ? 0x2f8a3a : 0x27783a)), OLs); c.position.y = (0.75 + i * 0.5) * s; c.castShadow = true; g.add(c); }
        g.position.set(x, LEVEL, z); deco.add(g); return g; };
      const bush = (x, z, s, col) => { const g = new T.Group(); for (let i = 0; i < 3; i++) { const b = outline(new T.Mesh(new T.SphereGeometry(s * (0.6 + Math.random() * 0.4), 14, 10), toon(col || 0x3fa34a)), OLs); b.position.set((i - 1) * s * 0.7, s * 0.5, Math.random() * s * 0.4); b.castShadow = true; g.add(b); } g.position.set(x, LEVEL, z); deco.add(g); return g; };
      const palm = (x, z, s) => { const g = new T.Group(), curve = 0.25; for (let i = 0; i < 6; i++) { const seg = outline(new T.Mesh(new T.CylinderGeometry(0.09 * s, 0.11 * s, 0.42 * s, 8), toon(i % 2 ? 0x9a6a3a : 0x8a5a30)), OLs); seg.position.set(Math.sin(i * 0.3) * curve * i * 0.3 * s, (0.21 + i * 0.4) * s, 0); seg.rotation.z = -i * 0.05; g.add(seg); }
        const top = new T.Vector3(Math.sin(1.5) * curve * 1.5 * s * 0.3, 2.5 * s, 0); for (let i = 0; i < 7; i++) { const lf = outline(new T.Mesh(new T.ConeGeometry(0.16 * s, 1.3 * s, 4), toon(i % 2 ? 0x3cb04a : 0x2f9a3e, { flatShading: true })), OLs); lf.geometry.translate(0, 0.65 * s, 0); lf.position.copy(top); lf.rotation.set(1.1, (i / 7) * Math.PI * 2, 0, "YXZ"); lf.scale.z = 0.35; lf.userData.sway = i; g.add(lf); }
        g.position.set(x, LEVEL, z); deco.add(g); upd.push((dt, t) => g.children.forEach((c) => { if (c.userData.sway != null) c.rotation.x = 1.1 + Math.sin(t * 1.5 + c.userData.sway) * 0.06; })); return g; };
      const ring = (n, r0, r1, fn) => { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0); fn(Math.cos(a) * r, Math.sin(a) * r - 8); } };
      if (theme === "lagon") { ring(10, 22, 60, (x, z) => { const isl = outline(new T.Mesh(new T.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xf3d99c)), OLs); const s = 2 + Math.random() * 4; isl.scale.set(s, s * 0.35, s); isl.position.set(x, LEVEL - 0.05, z); deco.add(isl); palm(x + 0.5, z, 1 + Math.random() * 0.6); if (Math.random() < 0.6) palm(x - 1.2, z + 0.8, 0.8 + Math.random() * 0.5); });
        ring(14, 18, 50, (x, z) => rock(x, z, 0.6 + Math.random() * 1.2, 0xa6a2a0)); }
      else if (theme === "foret") { ring(70, 16, 60, (x, z) => (Math.random() < 0.6 ? pine(x, z, 1.4 + Math.random() * 1.6) : bush(x, z, 0.8 + Math.random() * 0.7)));
        ring(14, 14, 40, (x, z) => rock(x, z, 0.5 + Math.random(), 0x9a9aa2));
        for (let i = 0; i < 9; i++) { const a = -Math.PI * 0.95 + (i / 8) * Math.PI * 0.9, m = outline(new T.Mesh(new T.ConeGeometry(9 + Math.random() * 7, 12 + Math.random() * 10, 6), toon(0x8a6a5a, { flatShading: true })), OLs);
          m.position.set(Math.cos(a) * 85, LEVEL + 5, Math.sin(a) * 85 - 10); deco.add(m); const cap = new T.Mesh(new T.ConeGeometry(3.4, 4, 6), toon(0xffffff, { flatShading: true })); cap.position.y = m.geometry.parameters.height / 2 - 2; m.add(cap); } }
      else if (theme === "rue") { const winT = tex(128, 256, (g, w, h) => { g.fillStyle = "#e9e2d8"; g.fillRect(0, 0, w, h); for (let y = 14; y < h - 10; y += 30) for (let x = 12; x < w - 10; x += 28) { g.fillStyle = Math.random() < 0.35 ? "#ffd27a" : "#33405a"; g.fillRect(x, y, 16, 20); g.strokeStyle = "#1a1a1f"; g.lineWidth = 2; g.strokeRect(x, y, 16, 20); } }, [1, 1]);
        const cols = [0xd9735a, 0xe8c27a, 0x7aa6d8, 0xc98ab8, 0x8ccf9a, 0xf0e2c8];
        ring(40, 18, 55, (x, z) => { const h = 4 + Math.random() * 12, w = 2.5 + Math.random() * 3, b = outline(new T.Mesh(new T.BoxGeometry(w, h, w), [toon(cols[Math.floor(Math.random() * cols.length)], { map: winT }), toon(cols[0], { map: winT }), toon(0x5a5560), toon(0x5a5560), toon(cols[2], { map: winT }), toon(cols[3], { map: winT })]), olPush(0.04)); b.position.set(x, LEVEL + h / 2, z); b.castShadow = true; deco.add(b); });
        ring(12, 10, 18, (x, z) => { const p = outline(new T.Mesh(new T.CylinderGeometry(0.06, 0.08, 3, 8), toon(0x3a3d44)), OLs); p.position.set(x, LEVEL + 1.5, z); deco.add(p); const l = new T.Mesh(new T.SphereGeometry(0.2, 12, 8), new T.MeshBasicMaterial({ color: new T.Color(2.5, 2, 1.2), toneMapped: false })); l.position.set(x, LEVEL + 3.1, z); deco.add(l); });
        ring(16, 10, 30, (x, z) => bush(x, z, 0.6, 0x4aa85a)); }
      else if (theme === "volcan") { ring(16, 14, 50, (x, z) => rock(x, z, 0.8 + Math.random() * 2, 0x2a2422));
        const cg = new T.CylinderGeometry(70, 45, 40, 40, 6, true), cp = cg.attributes.position; for (let i = 0; i < cp.count; i++) { const k = 1 + (Math.random() - 0.5) * 0.12; cp.setX(i, cp.getX(i) * k); cp.setZ(i, cp.getZ(i) * k); } cg.computeVertexNormals();
        const cr = new T.Mesh(cg, toon(0x3a2a26, { side: T.BackSide, flatShading: true, emissive: 0x2a0802 })); cr.position.set(0, LEVEL + 18, -10); deco.add(cr);
        if (FX) { const ember = G3.canvasTex(T, 64, 64, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, "rgba(255,220,160,1)"); r.addColorStop(0.3, "rgba(255,120,30,0.9)"); r.addColorStop(1, "rgba(255,60,0,0)"); g.fillStyle = r; g.fillRect(0, 0, w, w); });
          const pe = G3.particles(S, { count: 70, tex: ember, colors: ["#ff8a30", "#ffc060"], size: [0.06, 0.14], area: [-14, 24, -30, 8], y: [LEVEL, 8], fall: -0.7, wind: { x: 0.2, z: 0 }, additive: true }); upd.push((dt) => pe.update(dt)); } }
      else if (theme === "tempete") { ring(6, 30, 60, (x, z) => rock(x, z, 2 + Math.random() * 3, 0x30363c)); }
      // ---------------------------------------------------------------- construction d'un trou
      const RAIL = 0.15, RH = 0.2;
      /** extrusion le long du trou : profil [[lat, h, toBase]] du côté sg (+1 droite, -1 gauche), échantillons i0..i1 ; couleurs par sommet (fn(s)) */
      const sweep = (H, i0, i1, sg, prof, mat, colorFn) => { const S2 = H.S, pos = [], col = [], idx = [], c = new T.Color(); let v = 0;
        for (let e = 0; e < prof.length - 1; e++) { const start = v;
          for (let i = i0; i <= i1; i++) { const q = S2[i]; for (const k of [e, e + 1]) { const [lat, h, toBase] = prof[k], ox = q.nx * sg * (q.hw + lat), oz = q.nz * sg * (q.hw + lat); pos.push(q.x + ox, toBase ? LEVEL : q.y + h, q.z + oz); if (colorFn) { c.set(colorFn(q.s, e)); col.push(c.r, c.g, c.b); } v++; } }
          for (let i = 0; i < i1 - i0; i++) { const a = start + i * 2; if (sg > 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
        const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); if (colorFn) g.setAttribute("color", new T.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
        return new T.Mesh(g, mat); };
      const ribbon = (H, i0, i1, mat, y0) => { const S2 = H.S, pos = [], uv = [], idx = [];
        for (let i = i0; i <= i1; i++) { const q = S2[i]; pos.push(q.x - q.nx * q.hw, q.y + (y0 || 0), q.z - q.nz * q.hw, q.x + q.nx * q.hw, q.y + (y0 || 0), q.z + q.nz * q.hw); uv.push(-q.hw / 0.9, q.s / 0.9, q.hw / 0.9, q.s / 0.9); }
        for (let i = 0; i < i1 - i0; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
        const m = new T.Mesh(g, mat); m.receiveShadow = true; return m; };
      const runs = (H) => { const out = []; let st = 0; for (let i = 1; i < H.S.length; i++) if (H.S[i].wall !== H.S[st].wall || i === H.S.length - 1) { out.push([st, i, H.S[st].wall]); st = i; } return out; };
      const railCol = (s, e) => e === 1 ? C.top : C.stripe && Math.floor(s / 0.55) % 2 ? C.stripe : e === 0 ? C.inner : C.outer;
      const railM = toon(0xffffff, { vertexColors: true }), baseM = toon(C.base), topGlow = C.glowTop ? new T.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff5a0a, emissiveIntensity: 2.2 }) : null;
      let hole = null;
      const buildHole = (H) => {
        const g = new T.Group(); S.add(g);
        runs(H).forEach(([a, b, wall]) => {
          g.add(ribbon(H, a, b, wall ? turfM : plankM));
          [-1, 1].forEach((sg) => {
            if (wall) { const r = sweep(H, a, b, sg, [[0, 0], [0, RH], [RAIL, RH], [RAIL, 0, true]], railM, railCol); r.castShadow = true; r.receiveShadow = true; g.add(r);
              g.add(sweep(H, a, b, sg, [[-0.022, -0.01], [-0.022, RH + 0.022], [RAIL + 0.022, RH + 0.022], [RAIL + 0.022, 0, true]], olM));
              if (topGlow) g.add(sweep(H, a, b, sg, [[0.04, RH + 0.004], [RAIL - 0.04, RH + 0.004]], topGlow)); }
            else { g.add(sweep(H, a, b, sg, [[0, 0], [0, -0.14], [-0.02, -0.14]], baseM)); g.add(sweep(H, a, b, sg, [[0.02, 0.01], [0.02, -0.16]], olM));
              for (let i = a; i <= b; i += 18) { const q = H.S[i], px = q.x + q.nx * sg * (q.hw - 0.04), pz = q.z + q.nz * sg * (q.hw - 0.04); const post = outline(new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.32, 8), toon(0x7a5230)), OLs); post.position.set(px, q.y + 0.1, pz); g.add(post);
                const leg = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, q.y - LEVEL + 0.2, 8), toon(0x7a5230)); leg.position.set(px, (q.y + LEVEL) / 2 - 0.1, pz); g.add(leg); } } });
        });
        // dessous fermé + piliers (sur l'eau / la lave)
        if (C.fluid) for (let i = 0; i < H.S.length; i += 40) { const q = H.S[i]; if (!q.wall) continue; [-1, 1].forEach((sg) => { const p = new T.Mesh(new T.CylinderGeometry(0.1, 0.12, q.y - LEVEL + 2, 8), baseM); p.position.set(q.x + q.nx * sg * (q.hw + RAIL / 2), (q.y + LEVEL - 2) / 2, q.z + q.nz * sg * (q.hw + RAIL / 2)); g.add(p); }); }
        // murs du départ et du fond
        [[0, -1], [H.S.length - 1, 1]].forEach(([i, dir]) => { const q = H.S[i], w = 2 * (q.hw + RAIL), h = RH + q.y - LEVEL;
          const m = outline(new T.Mesh(new T.BoxGeometry(w, h, RAIL), toon(C.top)), olPush(0.02)); m.position.set(q.x + q.tx * dir * RAIL / 2, q.y + RH - h / 2, q.z + q.tz * dir * RAIL / 2); m.rotation.y = Math.atan2(q.tx, q.tz); m.castShadow = true; g.add(m); });
        // tapis de départ
        const tee = new T.Mesh(new T.PlaneGeometry(0.7, 0.7), toon(new T.Color(C.turf[0]).multiplyScalar(0.7))); tee.rotation.x = -Math.PI / 2; tee.rotation.z = Math.atan2(H.tee.tx, H.tee.tz); tee.position.set(H.tee.x, H.tee.y + 0.003, H.tee.z); g.add(tee);
        // eau sous les passerelles (décors au sol)
        if (!C.fluid) H.feat.filter((f) => f.k === "water").forEach((f) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; H.S.forEach((q) => { if (q.s > f.s0 - 1 && q.s < f.s1 + 1) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); } });
          const wm = waterMat(C.deep, C.shallow), w = new T.Mesh(new T.PlaneGeometry(x1 - x0 + 5, z1 - z0 + 3), wm); w.rotation.x = -Math.PI / 2; w.position.set((x0 + x1) / 2, LEVEL + 0.06, (z0 + z1) / 2); g.add(w); upd2.push((dt, t) => (wm.uniforms.uTime.value = t));
          const bank = outline(new T.Mesh(new T.CylinderGeometry(1, 1, 0.1, 32), toon(0x8a7a5a)), OLs); bank.scale.set((x1 - x0 + 5.6) / 2, 1, (z1 - z0 + 3.6) / 2); bank.position.set((x0 + x1) / 2, LEVEL + 0.02, (z0 + z1) / 2); g.add(bank); });
        // coupe + drapeau
        const cup = new T.Mesh(new T.CircleGeometry(GF.CUP, 32), new T.MeshBasicMaterial({ color: 0x050505 })); cup.rotation.x = -Math.PI / 2; cup.position.set(H.cup.x, H.cup.y + 0.004, H.cup.z); g.add(cup);
        const rim = new T.Mesh(new T.RingGeometry(GF.CUP, GF.CUP + 0.025, 32), new T.MeshBasicMaterial({ color: 0xffffff })); rim.rotation.x = -Math.PI / 2; rim.position.set(H.cup.x, H.cup.y + 0.005, H.cup.z); g.add(rim);
        const poleT = tex(16, 128, (gg, w, h) => { for (let i = 0; i < 8; i++) { gg.fillStyle = i % 2 ? "#ff3d63" : "#ffffff"; gg.fillRect(0, (i / 8) * h, w, h / 8); } });
        const pole = outline(new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 1.5, 8), toon(0xffffff, { map: poleT })), OLs); pole.position.set(H.cup.x, H.cup.y + 0.75, H.cup.z); g.add(pole);
        const n = order.indexOf(H.def.idx) + 1, flagT = tex(256, 160, (gg, w, h) => { gg.fillStyle = "#ff3d63"; gg.fillRect(0, 0, w, h); gg.fillStyle = "#fff"; gg.font = "900 110px Arial Black, Arial"; gg.textAlign = "center"; gg.textBaseline = "middle"; gg.fillText(String(n), w / 2, h / 2 + 6); });
        const fg = new T.PlaneGeometry(0.5, 0.31, 10, 4); fg.translate(0.25, 0, 0); const flag = new T.Mesh(fg, toon(0xffffff, { map: flagT, side: T.DoubleSide })); flag.position.set(H.cup.x + 0.02, H.cup.y + 1.33, H.cup.z); g.add(flag);
        const fbase = Float32Array.from(fg.attributes.position.array);
        upd2.push((dt, t) => { const p = fg.attributes.position; for (let i = 0; i < p.count; i++) { const x = fbase[i * 3]; p.setZ(i, Math.sin(x * 9 - t * 6) * 0.05 * (x / 0.5)); } p.needsUpdate = true; flag.rotation.y = Math.sin(t * 0.6) * 0.3 - 0.4; });
        // obstacles
        const dyn = [];
        H.feat.forEach((f) => {
          if (f.k === "bumper") { const b = new T.Group(), stem = outline(new T.Mesh(new T.CylinderGeometry(0.15, 0.17, 0.18, 20), toon(0xffffff)), OLs); stem.position.y = 0.09; b.add(stem);
            const capT = tex(128, 64, (gg, w, h) => { gg.fillStyle = "#ef2d4f"; gg.fillRect(0, 0, w, h); gg.fillStyle = "#fff"; for (let i = 0; i < 5; i++) { gg.beginPath(); gg.arc(Math.random() * w, Math.random() * h * 0.7, 6 + Math.random() * 6, 0, 7); gg.fill(); } });
            const cap = outline(new T.Mesh(new T.SphereGeometry(0.24, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xffffff, { map: capT })), OLs); cap.position.y = 0.17; b.add(cap); b.position.set(f.cx, f.q.y, f.cz); b.traverse((c) => { if (c.isMesh) c.castShadow = true; }); g.add(b); dyn.push({ f, m: b, k: 0 }); }
          else if (f.k === "mill") { const m = new T.Group(); m.position.set(f.cx, f.q.y, f.cz); g.add(m);
            const tower = outline(new T.Mesh(new T.CylinderGeometry(0.15, 0.2, 1.1, 14), toon(0xf6efe2)), OLs); tower.position.y = 0.55; tower.castShadow = true; m.add(tower);
            const roof = outline(new T.Mesh(new T.ConeGeometry(0.26, 0.4, 14), toon(0xd8452e)), OLs); roof.position.y = 1.3; m.add(roof);
            const sail = new T.Group(); sail.position.set(0, 1.0, 0.2); m.add(sail);
            for (let i = 0; i < 4; i++) { const bl = outline(new T.Mesh(new T.BoxGeometry(0.12, 0.62, 0.02), toon(i % 2 ? 0xffffff : 0xd8452e)), OLs); bl.geometry.translate(0, 0.33, 0); bl.rotation.z = (i * Math.PI) / 2; sail.add(bl); }
            const arm = new T.Group(); arm.position.y = 0.09; m.add(arm);
            const bar = outline(new T.Mesh(new T.BoxGeometry(f.arm * 2, 0.11, 0.12), toon(0xffd23a)), OLs); bar.castShadow = true; arm.add(bar);
            [-1, 1].forEach((sg) => { const tip = outline(new T.Mesh(new T.SphereGeometry(0.08, 12, 8), toon(0xd8452e)), OLs); tip.position.x = sg * f.arm; arm.add(tip); });
            dyn.push({ f, m, arm, sail }); }
          else if (f.k === "hammer") { const fr = new T.Group(); fr.position.set(f.cx, f.q.y, f.cz); fr.rotation.y = Math.atan2(f.q.nx, f.q.nz) + Math.PI / 2; g.add(fr);
            const hw = f.q.hw + RAIL, hgt = 1.7, postM = toon(0x2f7ad8);
            [-1, 1].forEach((sg) => { const p = outline(new T.Mesh(new T.BoxGeometry(0.14, hgt, 0.14), postM), olPush(0.02)); p.position.set(sg * hw, hgt / 2, 0); p.castShadow = true; fr.add(p); });
            const beam = outline(new T.Mesh(new T.BoxGeometry(hw * 2 + 0.3, 0.16, 0.18), postM), olPush(0.02)); beam.position.y = hgt; fr.add(beam);
            const pend = new T.Group(); pend.position.y = hgt; fr.add(pend);
            const chain = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, hgt - 0.24, 6), toon(0x777a80)); chain.position.y = -(hgt - 0.24) / 2; pend.add(chain);
            const ball = outline(new T.Mesh(new T.SphereGeometry(0.24, 18, 12), toon(0x3a3438)), OLs); ball.position.y = -(hgt - 0.24); ball.castShadow = true; pend.add(ball);
            for (let i = 0; i < 8; i++) { const sp = new T.Mesh(new T.ConeGeometry(0.05, 0.14, 6), toon(0xd8d8dc)); const a = (i / 8) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.25, -(hgt - 0.24) + Math.sin(a) * 0.25, 0); sp.rotation.z = a - Math.PI / 2; pend.add(sp); }
            dyn.push({ f, m: fr, pend, L: hgt - 0.24 }); }
          else if (f.k === "loop") { const q = f.q, R = f.R, lg = new T.Group(); g.add(lg);
            const pts = [], N = 64; for (let i = 0; i <= N; i++) { const th = (i / N) * Math.PI * 2, lat = (i / N - 0.5) * 0.3; pts.push(new T.Vector3(q.x + q.tx * Math.sin(th) * R + q.nx * lat, q.y + (1 - Math.cos(th)) * R, q.z + q.tz * Math.sin(th) * R + q.nz * lat)); }
            const trackPos = [], trackIdx = [], W = 0.34;
            pts.forEach((p, i) => { const th = (i / N) * Math.PI * 2, inward = new T.Vector3(-q.tx * Math.sin(th), Math.cos(th), -q.tz * Math.sin(th)); void inward; trackPos.push(p.x - q.nx * W, p.y, p.z - q.nz * W, p.x + q.nx * W, p.y, p.z + q.nz * W); });
            for (let i = 0; i < N; i++) { const a = i * 2; trackIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
            const tg = new T.BufferGeometry(); tg.setAttribute("position", new T.Float32BufferAttribute(trackPos, 3)); tg.setIndex(trackIdx); tg.computeVertexNormals();
            const track = new T.Mesh(tg, toon(0xff8a1f, { side: T.DoubleSide })); track.castShadow = true; lg.add(track);
            const tube = (off, col) => { const curve = new T.CatmullRomCurve3(pts.map((p) => p.clone().add(new T.Vector3(q.nx * off, 0.05, q.nz * off)))); const m = outline(new T.Mesh(new T.TubeGeometry(curve, 96, 0.045, 8, false), toon(col)), OLs); m.castShadow = true; lg.add(m); };
            tube(-W, 0xffc21a); tube(W, 0xffc21a);
            const supp = outline(new T.Mesh(new T.CylinderGeometry(0.06, 0.08, R * 2 + 0.2, 8), toon(0x2f7ad8)), OLs); supp.position.set(q.x + q.nx * (W + 0.25), q.y + R, q.z + q.nz * (W + 0.25)); lg.add(supp);
            dyn.push({ f, curve: pts }); }
        });
        return { g, dyn };
      };
      const upd2 = [];   // animations du trou courant (vidées à chaque trou)
      // ---------------------------------------------------------------- balles
      const ballT = (c) => tex(128, 64, (gg, w, h) => { gg.fillStyle = "#ffffff"; gg.fillRect(0, 0, w, h); gg.fillStyle = c; gg.fillRect(0, h * 0.4, w, h * 0.2); for (let i = 0; i < 60; i++) { gg.fillStyle = "rgba(0,0,0,0.06)"; gg.beginPath(); gg.arc(Math.random() * w, Math.random() * h, 2.5, 0, 7); gg.fill(); } });
      const balls = P.map((p, i) => { const m = outline(new T.Mesh(new T.SphereGeometry(GF.BALL, 24, 16), toon(0xffffff, { map: ballT(i ? PCOL[i] : "#45d8ff") })), OLs); m.castShadow = true; S.add(m);
        const sh = new T.Mesh(new T.CircleGeometry(GF.BALL * 1.1, 16), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })); sh.rotation.x = -Math.PI / 2; S.add(sh); return { m, sh }; });
      const trail = G3.trail(S, { color: 0xffffff, len: 20, width: GF.BALL * 0.9, y: 0.06, max: 6 });
      // visée : pointillés
      const dots = []; for (let i = 0; i < 14; i++) { const d = new T.Mesh(new T.SphereGeometry(0.03, 8, 6), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, toneMapped: false })); d.visible = false; S.add(d); dots.push(d); }
      // ---------------------------------------------------------------- HUD
      api.hud.innerHTML = `<div class="gf-top"><div class="gf-hole"><small id="gf-hn"></small><b id="gf-name"></b><span id="gf-par"></span></div><div class="gf-st"><small>Coups</small><b id="gf-n">0</b></div></div>
        <div class="gf-pl" id="gf-pl"></div><div class="gf-pow" id="gf-pow"><i></i><b>0</b></div><button class="gf-view" id="gf-view">Vue</button>
        <div class="gf-hint" id="gf-hint">Glisse à gauche ou à droite pour viser, tire vers le bas pour doser, relâche pour taper</div><div class="gf-ban" id="gf-ban" hidden></div>`;
      const $ = (s) => api.hud.querySelector(s);
      // ---------------------------------------------------------------- état de la partie
      const nP = P.length, score = P.map(() => order.map(() => null));
      let hi = -1, H = null, B = [], strokes = [], done = [], cur = 0, phase = "intro", clock = 0, acc = 0, aim = 0, power = 0, pending = null, overview = false, alive = true, lastWall = 0;
      const camS = { pos: new T.Vector3(0, 3, 3), look: new T.Vector3(0, 0, -2), dir: new T.Vector3(0, 0, -1), intro: 0 };
      const totals = () => P.map((_, p) => score[p].reduce((a, v, h) => a + (v == null ? 0 : v - GF.HOLES[order[h]].par), 0));
      const paint = () => { const d = H.def; $("#gf-hn").textContent = `Trou ${hi + 1}/${order.length}`; $("#gf-name").textContent = d.name; $("#gf-par").textContent = "Par " + d.par; $("#gf-n").textContent = strokes[cur] || 0;
        const tt = totals(); $("#gf-pl").innerHTML = P.map((p, i) => `<span class="${i === cur && phase !== "between" ? "on" : ""}${done[i] ? " done" : ""}"><i style="background:${i ? PCOL[i] : "#45d8ff"}"></i>${esc(p.name)}<b>${tt[i] > 0 ? "+" + tt[i] : tt[i] === 0 ? "E" : tt[i]}</b></span>`).join("");
        api.turn(phase === "aim" ? (P[cur].human ? (setup.mode === "bots" ? "À toi" : P[cur].name) : P[cur].name + " vise…") : "", cur); };
      const banner = (big, small, img, ms) => { const b = $("#gf-ban"); b.hidden = false; b.innerHTML = `${img ? `<img src="${img}" alt="">` : ""}<b>${esc(big)}</b>${small ? `<small>${esc(small)}</small>` : ""}`; b.classList.remove("in"); void b.offsetWidth; b.classList.add("in"); clearTimeout(b._t); b._t = setTimeout(() => { b.hidden = true; }, ms || 1800); };
      const setPower = (p) => { power = p; const el = $("#gf-pow"); el.classList.toggle("on", p > 0.02); el.querySelector("i").style.height = Math.round(p * 100) + "%"; el.querySelector("b").textContent = Math.round(p * 100); el.querySelector("i").style.background = `hsl(${120 - p * 120},90%,55%)`; };
      const ballPos = (p, out) => { const b = B[p]; if (b.loop) { const L = b.loop, k = Math.min(1, L.t / L.dur), th = k * Math.PI * 2, q = L.f.q, R = L.f.R, lat = L.d + (k - 0.5) * 0.3 * 0;
          return out.set(q.x + q.tx * Math.sin(th) * R + q.nx * lat + q.tx * k * 0.08, q.y + (1 - Math.cos(th)) * R + GF.BALL * Math.cos(th), q.z + q.tz * Math.sin(th) * R + q.nz * lat + q.tz * k * 0.08); }
        const q = H.S[b.idx]; return out.set(b.x, (b.cup ? q.y - 0.1 : q.y) + GF.BALL, b.z); };
      const defaultAim = (p) => { const b = B[p], q = H.S[b.idx], ahead = GF.sampleAt(H, Math.min(H.cupS, q.s + 3)); return Math.hypot(H.cup.x - b.x, H.cup.z - b.z) < 4 ? GF.angleTo(b, H.cup.x, H.cup.z) : GF.angleTo(b, ahead.x, ahead.z); };
      // ---------------------------------------------------------------- déroulé
      const startHole = (k) => {
        hi = k; if (hole) { S.scene.remove(hole.g); hole.g.traverse((c) => { if (c.geometry) c.geometry.dispose(); }); } upd2.length = 0;
        const def = GF.HOLES[order[k]]; def.idx = order[k]; H = GF.build(def); hole = buildHole(H);
        B = P.map(() => GF.ball(H)); strokes = P.map(() => 0); done = P.map(() => false); cur = -1; phase = "intro"; camS.intro = 0; pending = null; overview = false;
        keyT.position.set(H.cup.x * 0.5, 0, (H.cup.z + H.tee.z) / 2); S.key.position.set(keyT.position.x - 6, 14, keyT.position.z + 5);
        paint(); banner(`Trou ${k + 1} · ${def.name}`, "Par " + def.par, null, 2200);
      };
      const nextTurn = () => {
        if (done.every(Boolean)) return endHole();
        for (let k = 1; k <= nP; k++) { const p = (cur + k + nP) % nP; if (!done[p]) { cur = p; break; } }
        phase = "aim"; aim = defaultAim(cur); setPower(0); paint();
        $("#gf-hint").hidden = !P[cur].human;
        if (!P[cur].human) { const lvl = P[cur].level || "normal", t0 = clock + 1.1; setTimeout(() => { if (!alive || phase !== "aim") return; const sh = GF.botShot(H, B[cur], lvl, t0); pending = { p: cur, at: t0, sh }; aim = sh.angle; }, 250); }
      };
      const fire = (p, a, pw) => { strokes[p]++; GF.shoot(B[p], a, pw); phase = "roll"; trail.clear(); dots.forEach((d) => (d.visible = false)); setPower(0); paint();
        api.sfx("flick.shot", { intensity: pw, vol: 0.3 + pw * 0.5, rate: 1.2 }); api.vibrate(10 + Math.round(pw * 20)); };
      const settle = (p, ev) => {
        const b = B[p];
        if (ev === "water") { strokes[p]++; banner(C.fluid === "lava" ? "Dans la lave !" : "Plouf !", "+1 coup, la balle revient", null, 1500); b.x = b.rest.x; b.z = b.rest.z; b.idx = GF.nearest(H, b.x, b.z); api.sfx("flick.post", { vol: 0.5, rate: 0.6 }); }
        if (b.cup) { done[p] = true; score[p][hi] = strokes[p]; const lab = GF.label(strokes[p], H.def.par); banner(lab, P[p].name + " · " + strokes[p] + (strokes[p] > 1 ? " coups" : " coup"), strokes[p] === 1 ? "img/games/golf/fx_holeinone.webp" : null, 1700);
          api.sfx(strokes[p] <= H.def.par ? "flick.goal" : "chip.lay", { vol: 0.8 }); if (strokes[p] < H.def.par) api.vibrate([20, 40, 60]); }
        else if (strokes[p] >= GF.MAX_STROKES) { done[p] = true; score[p][hi] = GF.MAX_STROKES; banner("Balle ramassée", P[p].name + " · " + GF.MAX_STROKES + " coups", null, 1500); }
        phase = "wait"; paint(); setTimeout(() => { if (alive) nextTurn(); }, b.cup ? 1500 : 650);
      };
      const endHole = () => {
        phase = "between"; paint();
        const rows = P.map((p, i) => `<tr><td>${esc(p.name)}</td><td>${score[i][hi]}</td><td>${totals()[i] > 0 ? "+" + totals()[i] : totals()[i] === 0 ? "E" : totals()[i]}</td></tr>`).join("");
        const b = $("#gf-ban"); b.hidden = false; b.classList.remove("in"); void b.offsetWidth; b.classList.add("in"); clearTimeout(b._t);
        b.innerHTML = `<b>Trou ${hi + 1} terminé</b><table class="gf-card"><tr><th></th><th>Coups</th><th>Total</th></tr>${rows}</table>`;
        setTimeout(() => { if (!alive) return; b.hidden = true; if (hi + 1 < order.length) startHole(hi + 1); else finish(); }, 2600);
      };
      const finish = () => { const tot = P.map((_, i) => score[i].reduce((a, v) => a + v, 0)), best = Math.min(...tot), win = tot.filter((v) => v === best).length > 1 ? null : tot.indexOf(best), par = order.reduce((a, h) => a + GF.HOLES[h].par, 0);
        const me = P.findIndex((p) => p.human); api.end(win, `Score : ${tot[me >= 0 ? me : 0]} coups (par ${par})` + (nP > 1 ? " · " + P.map((p, i) => p.name + " " + tot[i]).join(", ") : "")); };
      // ---------------------------------------------------------------- toucher
      const cv = S.renderer.domElement; let drag = null;
      cv.addEventListener("pointerdown", (e) => { if (phase !== "aim" || !P[cur].human || overview) return; drag = { x: e.clientX, y: e.clientY, a: aim }; cv.setPointerCapture && cv.setPointerCapture(e.pointerId); });
      cv.addEventListener("pointermove", (e) => { if (!drag) return; aim = drag.a - (e.clientX - drag.x) * 0.0055; setPower(Math.max(0, Math.min(1, (e.clientY - drag.y) / (cv.clientHeight * 0.32)))); });
      const up = () => { if (!drag) return; drag = null; if (power > 0.03 && phase === "aim") fire(cur, aim, power); else setPower(0); };
      cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
      $("#gf-view").onclick = () => { overview = !overview; $("#gf-view").classList.toggle("on", overview); $("#gf-view").textContent = overview ? "Balle" : "Vue"; };
      // ---------------------------------------------------------------- boucle
      const tmp = new T.Vector3(), tmp2 = new T.Vector3(), up3 = new T.Vector3(0, 1, 0);
      S.onFrame((dt, t) => {
        upd.forEach((f) => f(dt, t)); upd2.forEach((f) => f(dt, t));
        if (!H) return;
        // physique à pas fixe
        acc += Math.min(dt, 0.05); let it = 0;
        while (acc >= GF.DT && it < 10) { acc -= GF.DT; clock += GF.DT; it++;
          if (pending && clock >= pending.at && phase === "aim") { const pd = pending; pending = null; fire(pd.p, pd.sh.angle, pd.sh.power); }
          if (phase === "roll") { const b = B[cur]; for (const e of GF.step(H, b, clock)) {
              if (e.k === "wall" && e.v > 0.4 && clock - lastWall > 0.08) { lastWall = clock; api.sfx("flick.wall", { intensity: Math.min(1, e.v / 5), vol: Math.min(0.8, e.v / 6) }); }
              else if (e.k === "bumper" || e.k === "mill" || e.k === "hammer") { api.sfx("flick.post", { intensity: Math.min(1, e.v / 4) }); S.shake(0.02, 0.15); }
              else if (e.k === "loop") api.sfx("bowl.roll", { vol: 0.6, rate: 1.4 });
              else if (e.k === "loopfail") banner("Pas assez de vitesse", "il faut taper plus fort pour le looping", null, 1300);
              else if (e.k === "lip") api.sfx("flick.post", { vol: 0.4, rate: 1.6 });
              else if (e.k === "water") { settle(cur, "water"); break; } }
            if (phase === "roll" && !b.moving) settle(cur, b.cup ? "cup" : "stop"); }
        }
        // obstacles animés
        hole.dyn.forEach((d) => { const f = d.f;
          if (f.k === "mill") { const a = (f.w || 1.2) * clock; d.arm.rotation.y = -a; d.sail.rotation.z = clock * 2; }
          else if (f.k === "hammer") { const w = f.w || 2, A = f.amp * f.q.hw, o2 = A * Math.sin(w * clock + (f.ph || 0)); d.pend.rotation.z = -Math.atan2(o2, d.L); }
          else if (f.k === "bumper" && d.k > 0) { d.k = Math.max(0, d.k - dt * 4); d.m.scale.setScalar(1 + d.k * 0.25); } });
        // balles
        B.forEach((b, p) => { const m = balls[p].m, prev = m.position.clone(); ballPos(p, m.position); const mv = m.position.distanceTo(prev);
          if (mv > 0 && mv < 1) { tmp.set(b.vx, 0, b.vz); if (tmp.lengthSq() > 1e-6) { tmp2.crossVectors(up3, tmp.normalize()); m.rotateOnWorldAxis(tmp2, mv / GF.BALL); } }
          m.visible = !(b.cup && phase !== "roll") && !(p !== cur && strokes[p] === 0 && Math.hypot(b.x - B[cur >= 0 ? cur : 0].x, b.z - B[cur >= 0 ? cur : 0].z) < 0.3); balls[p].sh.visible = m.visible && !b.loop; balls[p].sh.position.set(m.position.x, m.position.y - GF.BALL + 0.006, m.position.z);
          if (p === cur && phase === "roll") trail.push(m.position.x, m.position.z, Math.hypot(b.vx, b.vz)); });
        // visée
        const me = balls[Math.max(0, cur)].m;
        if (phase === "aim" && cur >= 0) { const len = 0.5 + power * 4 + (P[cur].human ? 0.8 : 0.4); dots.forEach((d, i) => { const k = (i + 1) / dots.length; d.visible = true; d.position.set(me.position.x + Math.sin(aim) * len * k, me.position.y - GF.BALL + 0.03, me.position.z - Math.cos(aim) * len * k); d.material.opacity = 1 - k * 0.7; d.material.color.setHSL(power > 0.02 ? 0.33 - power * 0.33 : 0, power > 0.02 ? 1 : 0, 1 - (power > 0.02 ? 0.45 : 0)); }); }
        // caméra
        const cam = S.camera, bp = me.position;
        let wantPos, wantLook;
        if (phase === "intro") { camS.intro = Math.min(1, camS.intro + dt / 2.4); const k = camS.intro, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2, q = GF.sampleAt(H, H.L * (1 - e) + H.teeS * e);
          wantPos = tmp.set(q.x - q.tx * 3.2, q.y + 2.6 - e * 1.2, q.z - q.tz * 3.2); wantLook = tmp2.set(q.x + q.tx * 2, q.y, q.z + q.tz * 2); cam.position.lerp(wantPos, Math.min(1, dt * 5)); camS.look.lerp(wantLook, Math.min(1, dt * 5)); cam.lookAt(camS.look);
          if (k >= 1) { phase = "ready"; setTimeout(() => { if (alive && phase === "ready") nextTurn(); }, 200); } return; }
        if (overview) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; H.S.forEach((q) => { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }); const span = Math.max(x1 - x0, z1 - z0) + 3;
          wantPos = tmp.set((x0 + x1) / 2, span * 0.95, (z0 + z1) / 2 + span * 0.45); wantLook = tmp2.set((x0 + x1) / 2, 0, (z0 + z1) / 2); }
        else if (phase === "roll" || phase === "wait") { const b = B[cur]; tmp.set(b.vx, 0, b.vz); if (tmp.lengthSq() > 0.3) camS.dir.lerp(tmp.normalize(), Math.min(1, dt * 2.2)).normalize();
          wantPos = tmp.copy(bp).addScaledVector(camS.dir, -2.6); wantPos.y = bp.y + 1.35; wantLook = tmp2.copy(bp).addScaledVector(camS.dir, 1.6); wantLook.y = bp.y; }
        else { camS.dir.set(Math.sin(aim), 0, -Math.cos(aim)); wantPos = tmp.copy(bp).addScaledVector(camS.dir, -2.3); wantPos.y = bp.y + 1.1; wantLook = tmp2.copy(bp).addScaledVector(camS.dir, 2.2); wantLook.y = bp.y - 0.1; }
        const k = Math.min(1, dt * (phase === "aim" && drag ? 12 : 4)); cam.position.lerp(wantPos, k); camS.look.lerp(wantLook, k); cam.lookAt(camS.look);
      });
      startHole(0);
      return { destroy: () => { alive = false; S.dispose(); }, _st: () => ({ hi, phase, cur, strokes: strokes.slice(), done: done.slice(), score, H, B, clock }), _theme: () => theme,
        _shoot: (a, pw) => { if (phase !== "aim" || !P[cur].human) return false; fire(cur, a == null ? defaultAim(cur) : a, pw); return true; }, _aim: () => defaultAim(cur), _skipHole: () => { B.forEach((b, i) => { if (!done[i]) { done[i] = true; score[i][hi] = 3; } }); endHole(); } };
    },
  });
})();
