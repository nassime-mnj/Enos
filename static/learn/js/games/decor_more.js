"use strict";
// DÉCORS SUPPLÉMENTAIRES (Flick, Néo-Cité, Bowling, Mini-golf) : s'ajoutent à js/games/flick_decor.js.
//   stade   : stade de foot de nuit, tribunes pleines (supporters qui sautent, ola), pylônes d'éclairage, panneaux LED défilants
//   rue     : terrain de quartier grillagé au coucher du soleil, immeubles, graffitis, lampadaires, route
//   volcan  : plateforme de basalte au fond d'un cratère, lac de lave animé, coulées, braises, bombes de lave
//   tempete : plateforme offshore en pleine mer agitée sous l'orage (houle de Gerstner, écume, pluie, éclairs)
// Les shaders (lave, mer d'orage, pluie) sont exposés dans E.decorFx pour les autres jeux.
(() => {
  const E = window.ENOS, G3 = E.g3d, D = E.flickDecor;
  if (!G3 || !D) return;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const FX = (E.decorFx = {});

  // ------------------------------------------------------------------ bruit GLSL commun
  const NOISE = `float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x), mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x), f.y); }
    float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }`;
  const TAIL = `#include <tonemapping_fragment>
      #include <colorspace_fragment>`;

  /** lave : croûte sombre qui dérive sur un magma très lumineux (le bloom fait briller ce qui dépasse 1) ; fall = coulée verticale (uv) */
  FX.lava = (T, o) => { o = o || {};
    return new T.ShaderMaterial({ fog: false, side: o.side || T.FrontSide, uniforms: { uTime: { value: 0 }, uScale: { value: o.scale || 0.22 }, uFall: { value: o.fall ? 1 : 0 }, uHeat: { value: o.heat || 1 } },
      vertexShader: `uniform float uTime, uFall; varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); if (uFall < 0.5) w.y += sin(w.x*0.4+uTime*0.6)*0.04 + sin(w.z*0.5-uTime*0.5)*0.04; vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform float uTime, uScale, uFall, uHeat; varying vec3 vW; varying vec2 vUv; ${NOISE}
        void main(){
          vec2 p = uFall > 0.5 ? vec2(vUv.x*3.0, vUv.y*5.0 + uTime*0.9) : vW.xz*uScale + vec2(uTime*0.02, uTime*0.013);
          vec2 q = vec2(fbm(p + uTime*0.05), fbm(p + vec2(5.2,1.3) - uTime*0.04));
          float n = fbm(p + 2.2*q + uTime*0.03);
          float crust = smoothstep(0.47, 0.64, n) * (uFall > 0.5 ? 0.55 : 1.0);
          vec3 hot = mix(vec3(1.0,0.28,0.02), vec3(1.0,0.82,0.32), pow(clamp(1.0-n,0.0,1.0), 2.5));
          vec3 col = mix(hot*1.45*uHeat, vec3(0.07,0.025,0.02), crust);
          col += vec3(1.0,0.32,0.02) * pow(max(0.0, 0.16 - abs(n-0.5))*6.0, 3.0) * 1.6;
          gl_FragColor = vec4(col, 1.0);
          ${TAIL}
        }` }); };

  /** mer d'orage : houle de Gerstner (4 trains de vagues), écume sur les crêtes, reflets froids, éclair (uFlash) */
  FX.stormSea = (T, o) => { o = o || {};
    return new T.ShaderMaterial({ fog: false, uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uAmp: { value: o.amp || 1 }, uLight: { value: new T.Vector3(-0.3, 0.5, -0.8).normalize() },
        uDeep: { value: new T.Color("#031620") }, uShallow: { value: new T.Color("#0f4a5c") }, uSky: { value: new T.Color("#26384a") }, uFoam: { value: new T.Color("#d6e4ea") } },
      vertexShader: `uniform float uTime, uAmp; varying vec3 vW; varying vec3 vN; varying float vH;
        vec3 wave(vec2 p, vec2 dir, float steep, float wl, inout vec3 tg, inout vec3 bn){
          float k = 6.28318/wl; float c = sqrt(9.8/k); vec2 d = normalize(dir); float f = k*(dot(d,p) - c*uTime); float a = steep/k*uAmp; float s = steep*uAmp;
          tg += vec3(-d.x*d.x*s*sin(f), d.x*s*cos(f), -d.x*d.y*s*sin(f));
          bn += vec3(-d.x*d.y*s*sin(f), d.y*s*cos(f), -d.y*d.y*s*sin(f));
          return vec3(d.x*a*cos(f), a*sin(f), d.y*a*cos(f)); }
        void main(){ vec4 w = modelMatrix*vec4(position,1.0); vec2 p = w.xz; vec3 tg = vec3(1.0,0.0,0.0), bn = vec3(0.0,0.0,1.0), o = vec3(0.0);
          o += wave(p, vec2(1.0,0.55), 0.20, 16.0, tg, bn);
          o += wave(p, vec2(0.6,1.0), 0.17, 9.5, tg, bn);
          o += wave(p, vec2(-0.45,1.0), 0.14, 5.8, tg, bn);
          o += wave(p, vec2(1.0,-0.35), 0.12, 3.4, tg, bn);
          o += wave(p, vec2(0.2,-1.0), 0.08, 2.1, tg, bn);
          w.xyz += o; vH = o.y; vN = normalize(cross(bn, tg)); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform float uTime, uFlash; uniform vec3 uLight, uDeep, uShallow, uSky, uFoam; varying vec3 vW; varying vec3 vN; varying float vH; ${NOISE}
        void main(){ vec2 p = vW.xz; float e = 0.12;
          float h0 = fbm(p*0.8 + uTime*0.5), hx = fbm((p+vec2(e,0.0))*0.8 + uTime*0.5), hz = fbm((p+vec2(0.0,e))*0.8 + uTime*0.5);
          vec3 n = normalize(normalize(vN) + vec3(h0-hx, 0.0, h0-hz)*2.2);
          vec3 v = normalize(cameraPosition - vW); float fres = 0.03 + 0.97*pow(1.0 - max(dot(n, v), 0.0), 5.0);
          vec3 base = mix(uDeep, uShallow, clamp(vH*0.7 + 0.35, 0.0, 1.0));
          vec3 sky = uSky * (1.0 + uFlash*5.0) + vec3(0.55,0.65,1.0)*uFlash*1.5;
          vec3 col = mix(base, sky, fres);
          vec3 r = reflect(-v, n); col += vec3(0.75,0.85,1.0) * pow(max(dot(r, uLight), 0.0), 90.0) * (0.25 + uFlash*5.0);
          float foam = smoothstep(0.5, 0.95, vH + fbm(p*1.6 - uTime*0.35)*0.55 - 0.1);
          foam += smoothstep(0.72, 0.9, fbm(p*3.1 + vec2(uTime*0.2, -uTime*0.15))) * 0.25;
          col = mix(col, uFoam*(0.55 + uFlash*2.5), clamp(foam, 0.0, 1.0)*0.85);
          gl_FragColor = vec4(col, 1.0);
          ${TAIL}
        }` }); };

  /** pluie : traits qui tombent (tout le calcul dans le shader), centrée sur cx,cz */
  FX.rain = (S, o) => { const T = S.T, n = G3.fx() ? (o.count || 1600) : Math.round((o.count || 1600) / 3), R = o.area || 30, H = o.h || 24;
    const pos = new Float32Array(n * 6), seed = new Float32Array(n * 6), end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { const x = rnd(-R, R), y = rnd(0, H), z = rnd(-R, R); for (let k = 0; k < 2; k++) { pos.set([x, y, z], (i * 2 + k) * 3); seed.set([x, y, z], (i * 2 + k) * 3); end[i * 2 + k] = k; } }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3)); g.setAttribute("aSeed", new T.BufferAttribute(seed, 3)); g.setAttribute("aEnd", new T.BufferAttribute(end, 1));
    const mat = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, uniforms: { uTime: { value: 0 }, uH: { value: H }, uY0: { value: o.y0 == null ? -2 : o.y0 }, uWind: { value: new T.Vector2(o.wind ? o.wind[0] : 3, o.wind ? o.wind[1] : 1) }, uFlash: { value: 0 } },
      vertexShader: `uniform float uTime, uH, uY0; uniform vec2 uWind; attribute vec3 aSeed; attribute float aEnd; varying float vA;
        void main(){ float sp = 16.0 + fract(aSeed.x*13.1)*6.0; float y = uY0 + mod(aSeed.y - uTime*sp, uH); vec3 p = vec3(aSeed.x + uWind.x*(y-uY0)*0.08, y, aSeed.z + uWind.y*(y-uY0)*0.08);
          vec3 dir = normalize(vec3(uWind.x*0.08*sp/16.0, -1.0, uWind.y*0.08*sp/16.0)); p -= dir * aEnd * 0.55; vA = 1.0 - aEnd*0.9;
          gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(p,1.0); }`,
      fragmentShader: `uniform float uFlash; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.62,0.7,0.8)*(0.35 + uFlash*1.5), vA*0.55); }` });
    const lines = new T.LineSegments(g, mat); lines.frustumCulled = false; lines.position.set(o.cx || 0, 0, o.cz || 0); S.add(lines);
    return { mesh: lines, update: (t, flash) => { mat.uniforms.uTime.value = t; mat.uniforms.uFlash.value = flash || 0; } };
  };

  /** éclairs : flash global + zébrure au loin. Renvoie {update(dt), strike()} ; o.onFlash(k) reçoit l'intensité */
  FX.lightning = (S, o) => { const T = S.T; let next = rnd(2, 5), flash = 0, bolt = null, life = 0;
    const mk = () => { const a = rnd(-Math.PI, Math.PI * 0.1), r = rnd(30, 60), x = Math.cos(a) * r, z = Math.min(-12, Math.sin(a) * r), pts = []; let px = x, py = 38, pz = z;
      while (py > -2) { pts.push(px, py, pz); px += rnd(-2.2, 2.2); pz += rnd(-1, 1); py -= rnd(1.5, 3.5); pts.push(px, py, pz); }
      const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
      const l = new T.LineSegments(geo, new T.LineBasicMaterial({ color: new T.Color(0xdfe9ff).multiplyScalar(6), toneMapped: false, transparent: true, fog: false })); S.add(l); return l; };
    const api = { flash: 0, strike: () => { if (bolt) { S.scene.remove(bolt); bolt.geometry.dispose(); bolt.material.dispose(); } bolt = mk(); life = 0.32; flash = 1; if (o.onStrike) o.onStrike(); },
      update: (dt) => { next -= dt; if (next <= 0) { api.strike(); next = rnd(3.5, 9); }
        if (bolt) { life -= dt; bolt.material.opacity = life > 0.2 ? 1 : life > 0.12 ? 0.2 : life > 0 ? 0.9 : 0; if (life <= 0) { S.scene.remove(bolt); bolt.geometry.dispose(); bolt.material.dispose(); bolt = null; } }
        flash = Math.max(0, flash - dt * 3.2); const k = flash > 0.6 ? flash : flash * (0.5 + 0.5 * Math.sin(flash * 40)); api.flash = Math.max(0, k); if (o.onFlash) o.onFlash(api.flash); } };
    return api;
  };

  // ------------------------------------------------------------------ textures
  const tex = (T, w, h, draw, rep) => { const t = G3.canvasTex(T, w, h, draw); if (rep) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } return t; };
  const grain = (g, w, h, n, a, light) => { for (let i = 0; i < n; i++) { g.fillStyle = Math.random() < (light || 0.5) ? `rgba(255,255,255,${Math.random() * a})` : `rgba(0,0,0,${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); } };
  const asphalt = (g, w, h, base) => { g.fillStyle = base || "#38393d"; g.fillRect(0, 0, w, h); grain(g, w, h, w * h / 18, 0.18, 0.45);
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "20,20,22" : "80,80,84"},${rnd(0.08, 0.2)})`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, rnd(20, 120), rnd(14, 60), Math.random() * 3, 0, 7); g.fill(); }
    g.strokeStyle = "rgba(10,10,12,0.5)"; g.lineWidth = 2; for (let i = 0; i < 10; i++) { g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += rnd(-40, 40); y += rnd(-40, 40); g.lineTo(x, y); } g.stroke(); } };
  const crackGlow = (g, w, h, n, wd) => { for (let i = 0; i < n; i++) { let x = Math.random() * w, y = Math.random() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += rnd(-50, 50); y += rnd(-50, 50); g.lineTo(x, y); }
      g.strokeStyle = "rgba(255,90,10,0.35)"; g.lineWidth = wd * 3.2; g.stroke(); g.strokeStyle = "rgba(255,170,60,0.95)"; g.lineWidth = wd; g.stroke(); } };

  // fonds de terrain
  D.surfBase.stade = (g, w, h) => { for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? "#2f8c36" : "#3aa142"; g.fillRect(0, (i / 16) * h, w, h / 16 + 1); }
    for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.035)"; g.fillRect((i / 6) * w, 0, w / 6, h); }
    for (let i = 0; i < 26000; i++) { g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${Math.random() * 0.08})` : `rgba(200,255,170,${Math.random() * 0.07})`; g.fillRect(Math.random() * w, Math.random() * h, 1.2, 2.6 + Math.random() * 2); } };
  D.surfBase.rue = (g, w, h) => { asphalt(g, w, h, "#3c3d42"); g.fillStyle = "rgba(30,90,140,0.22)"; g.fillRect(14, 14, w - 28, h - 28); grain(g, w, h, 9000, 0.1); };
  D.surfBase.volcan = (g, w, h) => { g.fillStyle = "#1d1b1c"; g.fillRect(0, 0, w, h); grain(g, w, h, 30000, 0.12, 0.35);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "60,50,48"},${rnd(0.1, 0.3)})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, rnd(10, 60), 0, 7); g.fill(); }
    crackGlow(g, w, h, 16, 2.2); const r = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75); r.addColorStop(0, "rgba(0,0,0,0)"); r.addColorStop(1, "rgba(255,80,10,0.18)"); g.fillStyle = r; g.fillRect(0, 0, w, h); };
  D.surfBase.tempete = (g, w, h) => { g.fillStyle = "#2b3238"; g.fillRect(0, 0, w, h);
    const s = 26; for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) { g.fillStyle = "rgba(255,255,255,0.05)"; g.save(); g.translate(x + s / 2, y + s / 2); g.rotate(((x + y) / s) % 2 ? 0.6 : -0.6); g.fillRect(-7, -2, 14, 4); g.restore(); }
    g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 3; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(0, (k / 4) * h); g.lineTo(w, (k / 4) * h); g.stroke(); } g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(120,70,40,${rnd(0.05, 0.18)})`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, rnd(8, 40), rnd(4, 18), Math.random() * 3, 0, 7); g.fill(); }
    const lg = g.createLinearGradient(0, 0, w, h); lg.addColorStop(0, "rgba(160,190,220,0.12)"); lg.addColorStop(0.5, "rgba(0,0,0,0)"); lg.addColorStop(1, "rgba(160,190,220,0.1)"); g.fillStyle = lg; g.fillRect(0, 0, w, h); };

  /** bandes et liserés selon le décor (Flick) */
  D.railFor = (T, M, theme) => ({
    stade: () => ({ rail: new T.MeshPhysicalMaterial({ color: 0xf2f4f6, roughness: 0.25, metalness: 0.2, clearcoat: 1 }), strip: new T.MeshBasicMaterial({ color: 0x9ef0ff, toneMapped: false }), cap: M.metal }),
    rue: () => ({ rail: new T.MeshStandardMaterial({ color: 0x8d949b, roughness: 0.45, metalness: 0.85 }), strip: new T.MeshBasicMaterial({ color: 0xffd23a, toneMapped: false }), cap: M.metal }),
    volcan: () => ({ rail: new T.MeshStandardMaterial({ color: 0x1a1716, roughness: 0.85, metalness: 0.1, flatShading: true }), strip: new T.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff5a0a, emissiveIntensity: 2.6 }), cap: new T.MeshStandardMaterial({ color: 0x2a2422, roughness: 0.9 }) }),
    tempete: () => ({ rail: new T.MeshStandardMaterial({ color: 0xe0b324, roughness: 0.5, metalness: 0.4 }), strip: new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), cap: M.metal }),
  }[theme] || (() => null))();

  // ------------------------------------------------------------------ STADE
  D.extra.stade = (S, m, out, H) => {
    const T = S.T, M = S.mats, hw = m.W / 2, hl = m.L / 2;
    H.sky(S, H.skyTex(T, [[0, "#02040b"], [0.5, "#08122a"], [0.82, "#1b2a49"], [1, "#2a3a58"]], null, 0), 0x0a1222, 0.007);
    S.scene.background = new T.Color(0x0a1222);
    H.lights(S, { key: 0xf4f8ff, ki: 3.4, kp: [2, 16, 5], sky: 0xc6d6ff, ground: 0x1d3a1c, hi: 0.75 });
    S.renderer.toneMappingExposure = 1.05;
    // pelouse autour du terrain + piste
    const lawn = new T.Mesh(new T.PlaneGeometry(m.W + 9, m.L + 10), new T.MeshStandardMaterial({ map: tex(T, 512, 512, (g, w, h) => D.surfBase.stade(g, w, h), [2, 3]), roughness: 0.9 })); lawn.rotation.x = -Math.PI / 2; lawn.position.y = -0.03; lawn.receiveShadow = true; S.add(lawn);
    const track = new T.Mesh(new T.PlaneGeometry(m.W + 16, m.L + 17), new T.MeshStandardMaterial({ color: 0x8a2b22, roughness: 0.95 })); track.rotation.x = -Math.PI / 2; track.position.y = -0.05; S.add(track);
    // panneaux LED défilants
    const ledT = tex(T, 2048, 64, (g, w, h) => { g.fillStyle = "#050608"; g.fillRect(0, 0, w, h); const items = [["E.N.O.S.", "#ff3d63"], ["ETO", "#1acfd6"], ["FLICK LEAGUE", "#ffffff"], ["DUALPULSE", "#e8b54a"], ["ETO", "#ff3d63"], ["E.N.O.S.", "#1acfd6"]];
      let x = 20; g.font = "900 46px Inter, Arial"; g.textBaseline = "middle"; items.forEach(([t, c]) => { g.fillStyle = c; g.fillText(t, x, h / 2 + 2); x += g.measureText(t).width + 90; g.fillStyle = "rgba(255,255,255,0.3)"; g.fillRect(x - 50, 12, 6, h - 24); });
      g.fillStyle = "rgba(0,0,0,0.35)"; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1); }, [1, 1]);
    const ledM = new T.MeshBasicMaterial({ map: ledT, toneMapped: false, color: new T.Color(1.6, 1.6, 1.6) }), frameM = new T.MeshStandardMaterial({ color: 0x111216, roughness: 0.5 });
    const led = (w, x, z, ry) => { const g = new T.Group(); const f = new T.Mesh(new T.BoxGeometry(w, 0.5, 0.12), frameM); f.position.y = 0.25; g.add(f); const s = new T.Mesh(new T.PlaneGeometry(w * 0.98, 0.42), ledM); s.position.set(0, 0.25, 0.065); g.add(s); g.position.set(x, -0.03, z); g.rotation.y = ry; S.add(g); };
    const lx = hw + 2.2, lz = hl + 2.4; led(m.L + 3.6, -lx, 0, Math.PI / 2); led(m.L + 3.6, lx, 0, -Math.PI / 2); led(m.W + 3.6, 0, -lz, 0); led(m.W + 3.6, 0, lz, Math.PI);
    H.upd.push((dt) => { ledT.offset.x = (ledT.offset.x + dt * 0.06) % 1; });
    // tribunes en gradins + supporters
    const sx0 = hw + 4, sz0 = hl + 4.4, ROWS = G3.fx() ? 11 : 7, step = 0.62, rise = 0.42, conc = new T.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.9 });
    const seatM = new T.MeshStandardMaterial({ color: 0x1b4fb0, roughness: 0.6 });
    const fans = [], add = (x, z, r, ry) => fans.push({ x, z, y: r * rise + 0.55, ry, ph: Math.random() * 6, hue: Math.random() });
    const side = (len, dist, axis, sgn) => { for (let r = 0; r < ROWS; r++) {
      const st = new T.Mesh(new T.BoxGeometry(axis === "x" ? step : len + r * step * 2, rise, axis === "x" ? len + r * step * 2 : step), r % 2 ? conc : seatM);
      const d = dist + r * step; if (axis === "x") st.position.set(sgn * d, r * rise + rise / 2 - 0.05, 0); else st.position.set(0, r * rise + rise / 2 - 0.05, sgn * d); st.receiveShadow = true; S.add(st);
      const L2 = len + r * step * 2, n = Math.floor(L2 / (G3.fx() ? 0.34 : 0.5)); for (let i = 0; i < n; i++) { const t = -L2 / 2 + (i + 0.5) * (L2 / n); if (axis === "x") add(sgn * d, t, r, sgn > 0 ? -Math.PI / 2 : Math.PI / 2); else add(t, sgn * d, r, sgn > 0 ? Math.PI : 0); } } };
    side(m.L + 8.8, sx0, "x", -1); side(m.L + 8.8, sx0, "x", 1); side(m.W + 8, sz0, "z", -1); side(m.W + 8, sz0, "z", 1);
    const fanG = new T.BoxGeometry(0.17, 0.27, 0.12), crowd = new T.InstancedMesh(fanG, new T.MeshStandardMaterial({ roughness: 0.7 }), fans.length), dm = new T.Object3D(), col = new T.Color();
    const SHIRTS = [0x45d8ff, 0xff3d63, 0xffffff, 0xe8b54a, 0x1b4fb0, 0x111111];
    fans.forEach((f, i) => crowd.setColorAt(i, col.setHex(SHIRTS[Math.floor(f.hue * SHIRTS.length)]).multiplyScalar(0.75 + Math.random() * 0.3)));
    crowd.frustumCulled = false; S.add(crowd);
    const heads = new T.InstancedMesh(new T.SphereGeometry(0.075, 8, 6), new T.MeshStandardMaterial({ roughness: 0.8 }), fans.length), SKIN = [0xf1c9a5, 0xd6a07a, 0xa5714d, 0x6e4a32, 0x3f2a1d];
    fans.forEach((f, i) => heads.setColorAt(i, col.setHex(SKIN[Math.floor(Math.random() * SKIN.length)]))); heads.frustumCulled = false; S.add(heads);
    let hype = 0, ola = -1;
    out.gust = ((g0) => (k) => { g0(k); hype = Math.max(hype, Math.min(1, k)); if (k > 0.8 && ola < 0) ola = 0; })(out.gust);
    H.upd.push((dt, t) => { hype *= Math.pow(0.5, dt); if (ola >= 0) { ola += dt * 0.9; if (ola > 1.4) ola = -1; }
      fans.forEach((f, i) => { const ang = (Math.atan2(f.z, f.x) / (Math.PI * 2) + 1) % 1, wave = ola >= 0 ? Math.max(0, 1 - Math.abs(ang - ola) * 9) : 0;
        const jump = Math.max(0, Math.sin(t * (6 + f.hue * 3) + f.ph)) * (0.03 + hype * 0.22) + wave * 0.35;
        dm.position.set(f.x, f.y + jump - 0.04, f.z); dm.rotation.set(0, f.ry, 0); dm.scale.set(1, 1 + wave * 0.4, 1); dm.updateMatrix(); crowd.setMatrixAt(i, dm.matrix);
        dm.position.y += 0.2 + wave * 0.06; dm.scale.set(1, 1, 1); dm.updateMatrix(); heads.setMatrixAt(i, dm.matrix); });
      crowd.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true; });
    // flashs d'appareils photo dans le public
    const flashT = tex(T, 64, 64, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, w, w); });
    const NF = 24, flashes = new T.InstancedMesh(new T.PlaneGeometry(0.5, 0.5), new T.MeshBasicMaterial({ map: flashT, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }), NF), FL = [];
    for (let i = 0; i < NF; i++) FL.push({ f: fans[Math.floor(Math.random() * fans.length)], t: Math.random() * 3 }); flashes.frustumCulled = false; S.add(flashes);
    H.upd.push((dt) => { FL.forEach((q, i) => { q.t -= dt * (1 + hype * 4); if (q.t < 0) { q.t = rnd(0.6, 3); q.f = fans[Math.floor(Math.random() * fans.length)]; } const on = q.t < 0.08 ? 1 : 0;
      dm.position.set(q.f.x, q.f.y + 0.3, q.f.z); dm.quaternion.copy(S.camera.quaternion); dm.scale.setScalar(on ? 1 : 0.0001); dm.updateMatrix(); flashes.setMatrixAt(i, dm.matrix); }); flashes.instanceMatrix.needsUpdate = true; });
    // toit (anneau) et rampe lumineuse
    const roofY = ROWS * rise + 2.2, roofM = new T.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6, metalness: 0.6, side: T.DoubleSide });
    [[m.L + 8.8 + ROWS * step * 2, sx0 + ROWS * step * 0.6, "x", -1], [m.L + 8.8 + ROWS * step * 2, sx0 + ROWS * step * 0.6, "x", 1], [m.W + 8 + ROWS * step * 2, sz0 + ROWS * step * 0.6, "z", -1], [m.W + 8 + ROWS * step * 2, sz0 + ROWS * step * 0.6, "z", 1]].forEach(([len, d, axis, sgn]) => {
      const r = new T.Mesh(new T.BoxGeometry(axis === "x" ? ROWS * step * 1.3 : len, 0.12, axis === "x" ? len : ROWS * step * 1.3), roofM); if (axis === "x") r.position.set(sgn * d, roofY, 0); else r.position.set(0, roofY, sgn * d); S.add(r);
      const lamp = new T.Mesh(new T.BoxGeometry(axis === "x" ? 0.12 : len * 0.9, 0.08, axis === "x" ? len * 0.9 : 0.12), new T.MeshBasicMaterial({ color: new T.Color(3, 3, 3.2), toneMapped: false }));
      const dd = d - ROWS * step * 0.62; if (axis === "x") lamp.position.set(sgn * dd, roofY - 0.08, 0); else lamp.position.set(0, roofY - 0.08, sgn * dd); S.add(lamp); });
    // pylônes d'éclairage aux coins
    const poleM = new T.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.9 }), bulbM = new T.MeshBasicMaterial({ color: new T.Color(4, 4, 3.8), toneMapped: false });
    const beamT = tex(T, 64, 256, (g, w, h) => { const lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, "rgba(255,255,255,0.32)"); lg.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = lg; g.fillRect(0, 0, w, h); });
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => { const x = sx * (sx0 + ROWS * step + 1.5), z = sz * (sz0 + ROWS * step + 1.5), ht = roofY + 6;
      const pole = new T.Mesh(new T.CylinderGeometry(0.16, 0.3, ht, 10), poleM); pole.position.set(x, ht / 2 - 0.05, z); S.add(pole);
      const head = new T.Group(); head.position.set(x, ht, z); head.lookAt(0, 0, 0); S.add(head);
      const panel = new T.Mesh(new T.BoxGeometry(2.6, 1.7, 0.2), poleM); head.add(panel);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { const b = new T.Mesh(new T.CircleGeometry(0.22, 16), bulbM); b.position.set(-0.96 + i * 0.64, -0.5 + j * 0.5, 0.11); head.add(b); }
      const beam = new T.Mesh(new T.ConeGeometry(3.2, ht * 1.35, 20, 1, true), new T.MeshBasicMaterial({ map: beamT, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false, opacity: 0.55 }));
      beam.geometry.translate(0, -ht * 1.35 / 2, 0); beam.position.copy(head.position); beam.quaternion.setFromUnitVectors(new T.Vector3(0, -1, 0), new T.Vector3(-x, -ht, -z).normalize()); S.add(beam); });
    // banc de touche et poteaux de corner
    const flagM = new T.MeshStandardMaterial({ color: 0xff3d63, side: T.DoubleSide, roughness: 0.6 });
    [[-hw - 0.5, -hl - 0.5], [hw + 0.5, -hl - 0.5], [-hw - 0.5, hl + 0.5], [hw + 0.5, hl + 0.5]].forEach(([x, z]) => { const p = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.8, 6), M.metal); p.position.set(x, 0.4, z); S.add(p); const f = new T.Mesh(new T.PlaneGeometry(0.28, 0.18), flagM); f.position.set(x + 0.14, 0.7, z); f.userData.sway = Math.random() * 6; S.add(f); H.upd.push((dt, t) => { f.rotation.y = Math.sin(t * 3 + f.userData.sway) * 0.4; }); });
    // confettis du public (papiers qui volent)
    H.parts.push(G3.particles(S, { count: 50, tex: H.leafTex(T, "petal"), colors: ["#ffffff", "#45d8ff", "#ff3d63", "#e8b54a"], size: [0.06, 0.1], area: [-hw - 6, hw + 6, -hl - 6, hl + 6], y: [0.02, 6], fall: 0.4, wind: { x: 0.5, z: 0.2 }, ground: 0.02, spin: 2 }));
    out.goalM = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.3 }); out.netColor = 0xffffff;
  };

  // ------------------------------------------------------------------ RUE
  D.extra.rue = (S, m, out, H) => {
    const T = S.T, M = S.mats, hw = m.W / 2, hl = m.L / 2;
    H.sky(S, H.skyTex(T, [[0, "#1e2444"], [0.42, "#5b4377"], [0.72, "#e5805a"], [0.9, "#ffbf80"], [1, "#ffd9a6"]], [0.3, 0.86, "rgba(255,230,180,1)", "rgba(255,140,90,0.55)"], 6), 0x5a4060, 0.012);
    H.lights(S, { key: 0xffb27a, ki: 2.6, kp: [-9, 6, -7], sky: 0x9c86c8, ground: 0x4a3328, hi: 0.95 });
    S.renderer.toneMappingExposure = 1.05;
    const ground = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshStandardMaterial({ map: tex(T, 1024, 1024, (g, w, h) => asphalt(g, w, h, "#2f3034"), [24, 24]), roughness: 0.85 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.04; ground.receiveShadow = true; S.add(ground);
    // route avec marquage, trottoirs
    const roadZ = -hl - 6.5, road = new T.Mesh(new T.PlaneGeometry(200, 5), new T.MeshStandardMaterial({ map: tex(T, 1024, 128, (g, w, h) => { asphalt(g, w, h, "#232428"); g.fillStyle = "#e9c440"; for (let x = 0; x < w; x += 80) g.fillRect(x, h / 2 - 3, 46, 6); g.fillStyle = "rgba(240,240,240,0.8)"; g.fillRect(0, 6, w, 4); g.fillRect(0, h - 10, w, 4); }, [20, 1]), roughness: 0.7 }));
    road.rotation.x = -Math.PI / 2; road.position.set(0, -0.035, roadZ); road.receiveShadow = true; S.add(road);
    const curbM = new T.MeshStandardMaterial({ color: 0x8c8a86, roughness: 0.9 });
    [roadZ - 2.7, roadZ + 2.7].forEach((z) => { const c = new T.Mesh(new T.BoxGeometry(200, 0.14, 0.4), curbM); c.position.set(0, 0.03, z); S.add(c); });
    const walk = new T.Mesh(new T.PlaneGeometry(200, 3), new T.MeshStandardMaterial({ map: tex(T, 256, 64, (g, w, h) => { g.fillStyle = "#9b958c"; g.fillRect(0, 0, w, h); g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 2; for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } grain(g, w, h, 2000, 0.12); }, [50, 1]), roughness: 0.9 }));
    walk.rotation.x = -Math.PI / 2; walk.position.set(0, 0.0, roadZ - 4.3); S.add(walk);
    // grillage du terrain (cage de quartier)
    const fenceT = tex(T, 128, 128, (g, w) => { g.clearRect(0, 0, w, w); g.strokeStyle = "rgba(200,205,210,1)"; g.lineWidth = 3; for (let k = -w; k < w * 2; k += 32) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + w, w); g.stroke(); g.beginPath(); g.moveTo(k + w, 0); g.lineTo(k, w); g.stroke(); } });
    fenceT.wrapS = fenceT.wrapT = T.RepeatWrapping;
    const fx = hw + 0.75, fz = hl + 1.1, fh = 2.4, postM = new T.MeshStandardMaterial({ color: 0x5f666d, roughness: 0.4, metalness: 0.9 });
    const panel = (len, x, z, ry, back) => { const t = fenceT.clone(); t.needsUpdate = true; t.repeat.set(len / 0.5, fh / 0.5);
      const p = new T.Mesh(new T.PlaneGeometry(len, fh), new T.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.4, side: T.DoubleSide, metalness: 0.7, roughness: 0.4, opacity: back ? 1 : 0.6 })); p.position.set(x, fh / 2 - 0.03, z); p.rotation.y = ry; S.add(p);
      const top = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, len, 8), postM); top.rotation.z = Math.PI / 2; top.rotation.y = ry; top.position.set(x, fh, z); S.add(top);
      const n = Math.max(2, Math.round(len / 2.2)); for (let i = 0; i <= n; i++) { const k = -len / 2 + (i / n) * len, pp = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, fh + 0.1, 8), postM); pp.position.set(x + Math.cos(ry) * k, fh / 2, z - Math.sin(ry) * k); S.add(pp); } };
    panel(fx * 2, 0, -fz, 0, true); panel(fz * 2, -fx, 0, Math.PI / 2, true); panel(fz * 2, fx, 0, Math.PI / 2, true);
    // côté caméra : juste une main courante basse (ne cache pas le jeu)
    const rail = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, fx * 2, 8), postM); rail.rotation.z = Math.PI / 2; rail.position.set(0, 0.9, fz); S.add(rail);
    [-fx, -fx / 3, fx / 3, fx].forEach((x) => { const pp = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 1, 8), postM); pp.position.set(x, 0.45, fz); S.add(pp); });
    // mur à graffitis derrière le terrain
    const graf = tex(T, 1024, 256, (g, w, h) => { g.fillStyle = "#8b8178"; g.fillRect(0, 0, w, h); g.strokeStyle = "rgba(0,0,0,0.18)"; g.lineWidth = 2; for (let y = 0; y < h; y += 26) for (let x = (y / 26) % 2 ? 0 : 30; x < w; x += 60) g.strokeRect(x, y, 60, 26); grain(g, w, h, 8000, 0.12);
      const blob = (x, y, r, c) => { g.fillStyle = c; g.beginPath(); for (let a = 0; a < 6.3; a += 0.4) g.lineTo(x + Math.cos(a) * r * rnd(0.7, 1.1), y + Math.sin(a) * r * rnd(0.6, 1)); g.fill(); };
      blob(140, 140, 90, "#2bc0e4"); blob(860, 120, 80, "#ff4fa3"); blob(520, 150, 70, "#ffd23a");
      g.lineJoin = "round"; g.font = "italic 900 150px Impact, Arial Black, Arial"; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = 26; g.strokeStyle = "#111"; g.strokeText("ETO", w / 2, h / 2 + 8); g.lineWidth = 12; g.strokeStyle = "#ffffff"; g.strokeText("ETO", w / 2, h / 2 + 8);
      const lg = g.createLinearGradient(0, 40, 0, h - 40); lg.addColorStop(0, "#ff3d63"); lg.addColorStop(1, "#ff9a3d"); g.fillStyle = lg; g.fillText("ETO", w / 2, h / 2 + 8);
      g.font = "900 44px Arial Black, Arial"; g.fillStyle = "#1acfd6"; g.save(); g.translate(170, 70); g.rotate(-0.18); g.fillText("E.N.O.S.", 0, 0); g.restore();
      g.fillStyle = "rgba(255,255,255,0.85)"; g.font = "700 30px Arial"; g.save(); g.translate(860, 200); g.rotate(0.1); g.fillText("FLICK 4EVER", 0, 0); g.restore(); });
    const wall = new T.Mesh(new T.BoxGeometry(m.W + 6, 3, 0.4), [curbM, curbM, curbM, curbM, new T.MeshStandardMaterial({ map: graf, roughness: 0.9 }), curbM]); wall.position.set(0, 1.47, -fz - 0.9); wall.castShadow = true; wall.receiveShadow = true; S.add(wall);
    // immeubles
    const facade = (base, lit) => { const t = tex(T, 256, 512, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); grain(g, w, h, 6000, 0.1); for (let y = 30; y < h - 40; y += 56) for (let x = 22; x < w - 30; x += 52) { g.fillStyle = "#1c2230"; g.fillRect(x, y, 30, 38); g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(x, y, 30, 4); g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(x - 3, y + 38, 36, 5); } g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, h - 70, w, 70); g.fillStyle = "#3a2c22"; g.fillRect(w / 2 - 24, h - 64, 48, 64); });
      const em = tex(T, 256, 512, (g, w, h) => { g.fillStyle = "#000"; g.fillRect(0, 0, w, h); for (let y = 30; y < h - 40; y += 56) for (let x = 22; x < w - 30; x += 52) if (Math.random() < lit) { g.fillStyle = Math.random() < 0.8 ? "#ffcf8a" : "#9fd8ff"; g.fillRect(x, y, 30, 38); } });
      return new T.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: em, emissiveIntensity: 0.9, roughness: 0.85 }); };
    const COLS = ["#b0624a", "#c99a6a", "#8f6e5a", "#d4c3a3", "#7d8a96", "#a8584c", "#e0b98a"], roofM = new T.MeshStandardMaterial({ color: 0x3b3433, roughness: 0.9 });
    const bldg = (x, z, w, h, d, ry) => { const mat = facade(COLS[Math.floor(Math.random() * COLS.length)], 0.35), b = new T.Mesh(new T.BoxGeometry(w, h, d), [mat, mat, roofM, roofM, mat, mat]); b.position.set(x, h / 2 - 0.04, z); b.rotation.y = ry || 0; b.castShadow = true; b.receiveShadow = true; S.add(b);
      const cap = new T.Mesh(new T.BoxGeometry(w + 0.2, 0.25, d + 0.2), roofM); cap.position.set(x, h, z); cap.rotation.y = ry || 0; S.add(cap); };
    for (let x = -26; x < 26;) { const w = rnd(3, 5.5); bldg(x + w / 2, roadZ - 8.5, w, rnd(5, 13), 5); x += w + rnd(0, 0.4); }
    [-1, 1].forEach((sg) => { for (let z = roadZ - 4; z < hl + 14;) { const d = rnd(3.2, 5); bldg(sg * (hw + 7.5 + rnd(0, 1)), z + d / 2, 4.5, rnd(4, 10), d); z += d + rnd(0.2, 1.4); } });
    // lampadaires
    const lampM = new T.MeshBasicMaterial({ color: new T.Color(3, 2.3, 1.4), toneMapped: false }), glowT = tex(T, 128, 128, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, "rgba(255,200,130,0.8)"); r.addColorStop(1, "rgba(255,160,80,0)"); g.fillStyle = r; g.fillRect(0, 0, w, w); });
    [[-fx - 1.4, -fz + 1], [fx + 1.4, -fz + 1], [-fx - 1.4, fz - 1.5], [fx + 1.4, fz - 1.5], [-8, roadZ + 3.2], [8, roadZ + 3.2]].forEach(([x, z]) => { const p = new T.Mesh(new T.CylinderGeometry(0.06, 0.09, 4.2, 8), postM); p.position.set(x, 2.08, z); S.add(p);
      const arm = new T.Mesh(new T.BoxGeometry(0.7, 0.06, 0.06), postM); arm.position.set(x - Math.sign(x) * 0.33, 4.15, z); S.add(arm);
      const bulb = new T.Mesh(new T.BoxGeometry(0.34, 0.08, 0.18), lampM); bulb.position.set(x - Math.sign(x) * 0.62, 4.1, z); S.add(bulb);
      const gl = new T.Sprite(new T.SpriteMaterial({ map: glowT, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false })); gl.position.copy(bulb.position); gl.scale.setScalar(1.6); S.add(gl);
      const l = new T.PointLight(0xffb070, 7, 9, 2); l.userData.decor = true; l.position.set(bulb.position.x, 3.8, z); S.add(l); });
    // accessoires : plots, poubelles, voiture garée
    const coneM = new T.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.6 }), whiteM = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    [[-fx - 0.6, fz + 0.9], [fx + 0.8, fz + 1.2], [fx + 0.5, -fz - 2.2]].forEach(([x, z]) => { const c = new T.Mesh(new T.ConeGeometry(0.17, 0.5, 14), coneM); c.position.set(x, 0.22, z); c.castShadow = true; S.add(c); const b = new T.Mesh(new T.CylinderGeometry(0.1, 0.12, 0.07, 14), whiteM); b.position.set(x, 0.28, z); S.add(b); });
    const binM = new T.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 0.6 }); [[-fx - 1.3, -fz - 1.6], [-fx - 1.9, -fz - 1.5]].forEach(([x, z]) => { const b = new T.Mesh(new T.CylinderGeometry(0.32, 0.28, 0.9, 16), binM); b.position.set(x, 0.42, z); b.castShadow = true; S.add(b); });
    const car = new T.Group(), carM = new T.MeshPhysicalMaterial({ color: 0xc8202c, roughness: 0.3, metalness: 0.6, clearcoat: 1 }), glassM = new T.MeshPhysicalMaterial({ color: 0x0c1520, roughness: 0.05, metalness: 0.2, clearcoat: 1 });
    const body = new T.Mesh(G3.roundedBox(T, 4, 0.7, 1.8, 0.25, 2), carM); body.position.y = 0.6; car.add(body); const cab = new T.Mesh(G3.roundedBox(T, 2.2, 0.6, 1.6, 0.25, 2), glassM); cab.position.set(-0.2, 1.2, 0); car.add(cab);
    const tyreM = new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }); [[-1.3, 0.85], [1.3, 0.85], [-1.3, -0.85], [1.3, -0.85]].forEach(([x, z]) => { const w = new T.Mesh(new T.CylinderGeometry(0.34, 0.34, 0.24, 18), tyreM); w.rotation.x = Math.PI / 2; w.position.set(x, 0.34, z); car.add(w); });
    car.position.set(5, 0, roadZ + 1.3); car.traverse((c) => { if (c.isMesh) c.castShadow = true; }); S.add(car);
    // voiture qui passe sur la route (phares)
    const car2 = car.clone(); car2.traverse((c) => { if (c.isMesh && c.material === carM) c.material = new T.MeshPhysicalMaterial({ color: 0x2a5fc8, roughness: 0.3, metalness: 0.6, clearcoat: 1 }); }); S.add(car2);
    const hl1 = new T.Mesh(new T.BoxGeometry(0.06, 0.12, 1.2), lampM); hl1.position.set(2.02, 0.65, 0); car2.add(hl1);
    H.upd.push((dt, t) => { car2.position.set(((t * 6) % 80) - 40, 0, roadZ - 1.2); });
    // poussière dorée dans la lumière rasante
    H.parts.push(G3.particles(S, { count: 40, tex: H.leafTex(T, "spark"), colors: ["#ffe0b0"], size: [0.03, 0.06], area: [-hw - 5, hw + 5, -hl - 5, hl + 5], y: [0.1, 4], fall: -0.04, wind: { x: 0.3, z: 0.1 }, additive: true }));
    H.parts.push(G3.particles(S, { count: 14, tex: H.leafTex(T, "maple"), colors: ["#d8d0c0", "#b8ad98"], size: [0.12, 0.2], area: [-hw - 4, hw + 4, -hl - 4, hl + 4], y: [0.02, 3], fall: 0.3, wind: { x: 1.2, z: 0.3 }, ground: 0.02, spin: 2 }));
    out.goalM = new T.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.35, metalness: 0.9 }); out.netColor = 0xe8e8e8;
  };

  // ------------------------------------------------------------------ VOLCAN
  D.extra.volcan = (S, m, out, H) => {
    const T = S.T, hw = m.W / 2, hl = m.L / 2, LV = -1.4;
    H.sky(S, H.skyTex(T, [[0, "#140606"], [0.4, "#2c0b07"], [0.75, "#5a1a0a"], [1, "#a8380e"]], null, 0), 0x1e0805, 0.012);
    H.lights(S, { key: 0xffd2b0, ki: 2.0, kp: [4, 14, 4], sky: 0x6a3a30, ground: 0xc04010, hi: 0.55 });
    S.renderer.toneMappingExposure = 1.0;
    // lac de lave
    const lavaM = FX.lava(T, { scale: 0.18 }), lava = new T.Mesh(new T.PlaneGeometry(140, 140, 80, 80), lavaM); lava.rotation.x = -Math.PI / 2; lava.position.y = LV; S.add(lava);
    const mats = [lavaM]; H.upd.push((dt, t) => mats.forEach((x) => (x.uniforms.uTime.value = t)));
    // paroi du cratère (cylindre ouvert, roche déformée, failles incandescentes en bas)
    const wallTex = H.rockTex(T, "#2a2322", [["#1a1414", 80, 40], ["#3b2a24", 60, 30]]);
    const wallEm = tex(T, 512, 512, (g, w, h) => { g.fillStyle = "#000"; g.fillRect(0, 0, w, h); for (let i = 0; i < 30; i++) { let x = Math.random() * w, y = h - Math.random() * h * 0.45; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += rnd(-30, 30); y -= rnd(5, 40); g.lineTo(x, y); } g.strokeStyle = "rgba(255,110,20,0.9)"; g.lineWidth = rnd(1.5, 4); g.stroke(); }
      const lg = g.createLinearGradient(0, h, 0, h * 0.6); lg.addColorStop(0, "rgba(255,90,20,0.3)"); lg.addColorStop(1, "rgba(255,90,20,0)"); g.fillStyle = lg; g.fillRect(0, 0, w, h); });
    wallTex.wrapS = wallEm.wrapS = wallTex.wrapT = wallEm.wrapT = T.RepeatWrapping; wallTex.repeat.set(6, 2); wallEm.repeat.set(6, 1);
    const cg = new T.CylinderGeometry(40, 24, 26, 72, 18, true), cp = cg.attributes.position;
    for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i), a = Math.atan2(z, x), k = 1 + Math.sin(a * 7 + y * 0.3) * 0.06 + Math.sin(a * 17 - y * 0.7) * 0.035 + Math.sin(a * 3) * 0.05 + (Math.random() - 0.5) * 0.03; cp.setXYZ(i, x * k, y + Math.sin(a * 5) * 1.2, z * k); }
    cg.computeVertexNormals();
    const crater = new T.Mesh(cg, new T.MeshStandardMaterial({ map: wallTex, emissive: 0xffffff, emissiveMap: wallEm, emissiveIntensity: 0.55, roughness: 0.95, side: T.BackSide, flatShading: true })); crater.position.y = LV + 12.5; S.add(crater);
    // coulées de lave sur la paroi
    [[-0.5, 1], [2.4, 0.8], [3.6, 1.2]].forEach(([a, wd]) => { const fm = FX.lava(T, { fall: true, side: T.DoubleSide, heat: 1.1 }); mats.push(fm); const r = 22.6, f = new T.Mesh(new T.PlaneGeometry(2.2 * wd, 24, 1, 12), fm); f.geometry.translate(0, 12, 0);
      const fp = f.geometry.attributes.position; for (let i = 0; i < fp.count; i++) fp.setZ(i, -fp.getY(i) * 0.6); f.geometry.computeVertexNormals();
      f.position.set(Math.cos(a - Math.PI / 2) * r, LV - 0.1, Math.sin(a - Math.PI / 2) * r); f.lookAt(0, LV - 0.1, 0); S.add(f);
      const l = new T.PointLight(0xff6a1a, 30, 22, 2); l.userData.decor = true; l.position.set(Math.cos(a - Math.PI / 2) * (r - 3), LV + 2, Math.sin(a - Math.PI / 2) * (r - 3)); S.add(l); });
    // plateforme de basalte (dessous déchiqueté qui plonge dans la lave)
    const rockM = new T.MeshStandardMaterial({ map: H.rockTex(T, "#2b2726", [["#1a1716", 90, 30]]), roughness: 0.95, flatShading: true, emissive: 0xffffff, emissiveMap: tex(T, 512, 512, (g, w, h) => { g.fillStyle = "#000"; g.fillRect(0, 0, w, h); crackGlow(g, w, h, 10, 2); }), emissiveIntensity: 0.9 });
    const pw = m.W + 2.4, pl = m.L + 2.4, slab = new T.Mesh(G3.roundedBox(T, pw, 0.6, pl, 0.5, 3), rockM); slab.position.y = -0.32; slab.receiveShadow = true; S.add(slab);
    const ug = new T.ConeGeometry(1, 1, 16, 5, true), up = ug.attributes.position; for (let i = 0; i < up.count; i++) { if (up.getY(i) < 0.49) { const k = 1 + (Math.random() - 0.5) * 0.25; up.setX(i, up.getX(i) * k); up.setZ(i, up.getZ(i) * k); } } ug.computeVertexNormals(); ug.rotateX(Math.PI);
    const under = new T.Mesh(ug, rockM); under.scale.set(pw * 0.72, 4, pl * 0.72); under.position.y = -0.62 - 2; S.add(under);
    // halo de chaleur sous la plateforme
    const heat = new T.PointLight(0xff5a10, 16, 14, 2); heat.userData.decor = true; heat.position.set(0, LV + 0.6, 0); S.add(heat);
    H.upd.push((dt, t) => { heat.intensity = 14 + Math.sin(t * 2.3) * 3 + Math.sin(t * 7.1) * 1.5; });
    // îlots de roche dans la lave
    for (let i = 0; i < 10; i++) { const a = rnd(0, 6.28), r = rnd(hw + 6, 22), g = new T.IcosahedronGeometry(rnd(0.6, 2), 1), p = g.attributes.position; for (let k = 0; k < p.count; k++) p.setXYZ(k, p.getX(k) * rnd(0.8, 1.2), Math.max(-0.3, p.getY(k)) * rnd(0.5, 0.9), p.getZ(k) * rnd(0.8, 1.2)); g.computeVertexNormals();
      const rk = new T.Mesh(g, rockM); rk.position.set(Math.cos(a) * r, LV, Math.sin(a) * r); S.add(rk); }
    // bombes de lave (projetées depuis le lac)
    const NBomb = 14, bombs = new T.InstancedMesh(new T.IcosahedronGeometry(0.14, 1), new T.MeshBasicMaterial({ color: new T.Color(4, 1.4, 0.3), toneMapped: false }), NBomb), BB = [], dm = new T.Object3D();
    bombs.frustumCulled = false; bombs.count = 0; S.add(bombs); let nextB = 1;
    const erupt = (n) => { const a = rnd(0, 6.28), r = rnd(hw + 5, 16), x = Math.cos(a) * r, z = Math.sin(a) * r; for (let i = 0; i < n && BB.length < NBomb; i++) BB.push({ x, y: LV, z, vx: rnd(-2, 2), vy: rnd(5, 9), vz: rnd(-2, 2), s: rnd(0.6, 1.4) }); };
    H.upd.push((dt) => { nextB -= dt; if (nextB < 0) { erupt(Math.floor(rnd(3, 7))); nextB = rnd(1.5, 4); }
      for (let i = BB.length - 1; i >= 0; i--) { const b = BB[i]; b.vy -= 9.8 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; if (b.y < LV) BB.splice(i, 1); }
      BB.forEach((b, i) => { dm.position.set(b.x, b.y, b.z); dm.scale.setScalar(b.s); dm.updateMatrix(); bombs.setMatrixAt(i, dm.matrix); }); bombs.count = BB.length; bombs.instanceMatrix.needsUpdate = true; });
    out.gust = ((g0) => (k) => { g0(k); if (k > 0.6) erupt(6); })(out.gust);
    // braises qui montent + fumée
    H.parts.push(G3.particles(S, { count: 90, tex: H.leafTex(T, "ember"), colors: ["#ff7a20", "#ffb040", "#ff4010"], size: [0.05, 0.14], area: [-hw - 8, hw + 8, -hl - 8, hl + 6], y: [LV, 9], fall: -0.7, wind: { x: 0.25, z: -0.1 }, additive: true }));
    const smokeT = tex(T, 128, 128, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, "rgba(255,255,255,0.5)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, w, w); });
    H.parts.push(G3.particles(S, { count: 18, tex: smokeT, colors: ["#3a2a26", "#4a3a34"], size: [3, 6], area: [-20, 20, -24, 10], y: [LV, 14], fall: -0.5, wind: { x: 0.4, z: 0.1 }, spin: 0.1 }));
    out.goalM = new T.MeshStandardMaterial({ color: 0x2a2422, roughness: 0.5, metalness: 0.7, emissive: 0x3a0e02 }); out.netColor = 0xffb070;
  };

  // ------------------------------------------------------------------ TEMPÊTE
  D.extra.tempete = (S, m, out, H) => {
    const T = S.T, M = S.mats, hw = m.W / 2, hl = m.L / 2, SEA = -2.6;
    const skyT = tex(T, 1024, 512, (g, w, h) => { const lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, "#07090d"); lg.addColorStop(0.5, "#141c26"); lg.addColorStop(0.85, "#24323f"); lg.addColorStop(1, "#2c3a46"); g.fillStyle = lg; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 160; k++) { const x = Math.random() * w, y = h * rnd(0.05, 0.7), r = rnd(30, 120), q = g.createRadialGradient(x, y, 0, x, y, r); const c = Math.random() < 0.5 ? "10,13,18" : "48,58,70"; q.addColorStop(0, `rgba(${c},${rnd(0.2, 0.45)})`); q.addColorStop(1, `rgba(${c},0)`); g.fillStyle = q; g.fillRect(x - r, y - r, r * 2, r * 2); } });
    const dome = H.sky(S, skyT, 0x101820, 0.02);
    H.lights(S, { key: 0xa8c0e0, ki: 1.1, kp: [-5, 12, -8], sky: 0x4a5a70, ground: 0x05080c, hi: 0.7 });
    S.renderer.toneMappingExposure = 1.0;
    const hemi = S.scene.children.find((c) => c.isHemisphereLight), hemiBase = hemi ? hemi.intensity : 0.7, keyBase = S.key.intensity;
    const sea = FX.stormSea(T), water = new T.Mesh(new T.PlaneGeometry(240, 240, G3.fx() ? 220 : 120, G3.fx() ? 220 : 120), sea); water.rotation.x = -Math.PI / 2; water.position.y = SEA; S.add(water);
    // plateforme offshore : pont d'acier, bande de sécurité, jambes et entretoises
    const pw = m.W + 2.6, pl = m.L + 2.6, steel = new T.MeshStandardMaterial({ color: 0x3b4248, roughness: 0.45, metalness: 0.85 });
    const hazard = tex(T, 512, 64, (g, w, h) => { for (let x = -h; x < w + h; x += 48) { g.fillStyle = "#f2c21b"; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 24, 0); g.lineTo(x + 24 - h, h); g.lineTo(x - h, h); g.fill(); g.fillStyle = "#16171a"; g.beginPath(); g.moveTo(x + 24, 0); g.lineTo(x + 48, 0); g.lineTo(x + 48 - h, h); g.lineTo(x + 24 - h, h); g.fill(); } grain(g, w, h, 3000, 0.2); }, [6, 1]);
    const deck = new T.Mesh(new T.BoxGeometry(pw, 0.7, pl), [new T.MeshStandardMaterial({ map: hazard, roughness: 0.6 }), new T.MeshStandardMaterial({ map: hazard, roughness: 0.6 }), steel, steel, new T.MeshStandardMaterial({ map: hazard, roughness: 0.6 }), new T.MeshStandardMaterial({ map: hazard, roughness: 0.6 })]);
    deck.position.y = -0.37; deck.castShadow = true; deck.receiveShadow = true; S.add(deck);
    const legM = new T.MeshStandardMaterial({ color: 0xd9a21c, roughness: 0.55, metalness: 0.5 });
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => { const leg = new T.Mesh(new T.CylinderGeometry(0.45, 0.55, 14, 16), legM); leg.position.set(sx * (pw / 2 - 0.6), -7.6, sz * (pl / 2 - 0.6)); S.add(leg); });
    [-1, 1].forEach((sx) => { const b = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, pl, 8), legM); b.rotation.x = Math.PI / 2; b.position.set(sx * (pw / 2 - 0.6), -2.2, 0); S.add(b); const b2 = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, Math.hypot(pl, 3), 8), legM); b2.rotation.x = Math.PI / 2 - Math.atan2(3, pl); b2.position.set(sx * (pw / 2 - 0.6), -3.4, 0); S.add(b2); });
    // projecteurs de pont (lumière chaude qui tranche dans le bleu)
    const lampM = new T.MeshBasicMaterial({ color: new T.Color(3.5, 3, 2.2), toneMapped: false });
    [[-pw / 2 + 0.3, -pl / 2 + 0.3], [pw / 2 - 0.3, -pl / 2 + 0.3], [-pw / 2 + 0.3, pl / 2 - 0.3], [pw / 2 - 0.3, pl / 2 - 0.3]].forEach(([x, z]) => { const p = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 1.6, 8), steel); p.position.set(x, 0.8, z); S.add(p);
      const h = new T.Mesh(new T.BoxGeometry(0.3, 0.18, 0.18), lampM); h.position.set(x, 1.62, z); S.add(h); const l = new T.PointLight(0xffd29a, 9, 10, 2); l.userData.decor = true; l.position.set(x * 0.9, 1.5, z * 0.9); S.add(l); });
    // feu de signalisation rouge clignotant
    const beacon = new T.Mesh(new T.SphereGeometry(0.1, 12, 8), new T.MeshBasicMaterial({ color: new T.Color(5, 0.4, 0.4), toneMapped: false })); beacon.position.set(pw / 2 - 0.3, 1.8, -pl / 2 + 0.3); S.add(beacon);
    // bateau au loin, ballotté par la houle
    const ship = new T.Group(), hullM = new T.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.6 }); const hull = new T.Mesh(new T.BoxGeometry(6, 1.2, 1.6), hullM); ship.add(hull); const cab = new T.Mesh(new T.BoxGeometry(1.4, 1.2, 1.2), new T.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.6 })); cab.position.set(-1.6, 1.1, 0); ship.add(cab);
    const shipL = new T.Mesh(new T.SphereGeometry(0.08, 8, 6), lampM); shipL.position.set(-1.6, 1.8, 0); ship.add(shipL); ship.position.set(-24, SEA + 0.2, -34); ship.rotation.y = 0.4; S.add(ship);
    // pluie, éclaboussures sur le pont, embruns
    const rain = FX.rain(S, { count: 1800, area: 22, h: 22, y0: -2.2, wind: [4, 1.2] });
    const ringT = tex(T, 64, 64, (g, w) => { g.strokeStyle = "rgba(255,255,255,0.8)"; g.lineWidth = 3; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, 7); g.stroke(); });
    const NS = G3.fx() ? 70 : 25, splash = new T.InstancedMesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: ringT, transparent: true, depthWrite: false, opacity: 0.5, toneMapped: false }), NS), SP = [], dm = new T.Object3D();
    for (let i = 0; i < NS; i++) SP.push({ x: rnd(-hw, hw), z: rnd(-hl, hl), t: Math.random() }); splash.frustumCulled = false; S.add(splash);
    H.upd.push((dt) => { SP.forEach((s, i) => { s.t += dt * 2.5; if (s.t > 1) { s.t = 0; s.x = rnd(-hw - 1, hw + 1); s.z = rnd(-hl - 1, hl + 1); } dm.position.set(s.x, 0.015, s.z); dm.rotation.set(-Math.PI / 2, 0, 0); dm.scale.setScalar(0.02 + s.t * 0.16); dm.updateMatrix(); splash.setMatrixAt(i, dm.matrix); }); splash.instanceMatrix.needsUpdate = true; });
    H.parts.push(G3.particles(S, { count: 50, tex: H.leafTex(T, "spark"), colors: ["#cfe0ea"], size: [0.12, 0.3], area: [-hw - 5, hw + 5, -hl - 5, hl + 5], y: [-2, 1.5], fall: -0.3, wind: { x: 3.5, z: 1 }, additive: true }));
    // éclairs
    const bolt = FX.lightning(S, { onStrike: () => { if (out.onThunder) out.onThunder(); },
      onFlash: (k) => { sea.uniforms.uFlash.value = k; if (hemi) hemi.intensity = hemiBase + k * 4; S.key.intensity = keyBase + k * 5; dome.material.color.setScalar(1 + k * 2.5); } });
    H.upd.push((dt, t) => { sea.uniforms.uTime.value = t; rain.update(t, bolt.flash); bolt.update(dt); beacon.visible = Math.sin(t * 4) > 0.2;
      ship.position.y = SEA + 0.2 + Math.sin(t * 0.9) * 0.6; ship.rotation.z = Math.sin(t * 0.7) * 0.12; ship.rotation.x = Math.sin(t * 0.8 + 1) * 0.08; });
    out.gust = ((g0) => (k) => { g0(k); if (k > 0.9 && Math.random() < 0.3) bolt.strike(); })(out.gust);
    out.goalM = M.metal; out.netColor = 0xdfe8ee; out.lightning = bolt;
  };

  /**
   * monte un décor autour d'une zone carrée/rectangulaire quelconque (Néo-Cité, bowling) :
   * le décor est construit dans un groupe abaissé à `y` (dessus de la table) ; renvoie l'objet décor (update, gust, ready…)
   */
  D.mount = (S, theme, m, y, z) => {
    const grp = new S.T.Group(); grp.position.y = y || 0; grp.position.z = z || 0; S.add(grp);
    const S2 = Object.create(S); S2.add = (...x) => grp.add(...x);
    const out = D.build(S2, theme, m, false); out.group = grp; return out;
  };
})();
