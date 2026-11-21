"use strict";
// SOCLE 3D DES JEUX (three.js r159, vendor/three.min.js chargé à la demande) : rendu « cinéma » dans la DA E.N.O.S.
//   - ACES filmique, sRGB, ombres douces, brouillard ; environnement de studio généré (panneaux lumineux blancs + cramoisis) pour des reflets propres
//   - matériaux : obsidienne vernie, métal brossé, or, néon cramoisi / cyan, feutre ; géométries arrondies (plateaux, tables)
//   - scène prête : caméra, lumières (clé, contre-jour rouge, remplissage), boucle d'animation, redimensionnement, sélection au toucher (raycast)
(() => {
  const E = window.ENOS;
  const G3 = (E.g3d = {});
  let loading = null;
  /** charge three.js une seule fois (≈ 650 Ko, seulement quand un jeu 3D s'ouvre) */
  G3.ready = () => {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = (G3.base || "") + "vendor/three.min.js";
      s.onload = () => (window.THREE ? res(window.THREE) : rej(new Error("three.js indisponible")));
      s.onerror = () => { loading = null; rej(new Error("three.js introuvable")); };
      document.head.appendChild(s);
    });
    return loading;
  };
  G3.C = { obsidian: 0x0b0c10, graphite: 0x1b1c23, crimson: 0xef1748, crimson2: 0xff3d63, cyan: 0x1acfd6, gold: 0xe8b54a, cream: 0xe5dfd6, ivory: 0xf3ead9 };

  /** environnement de studio (comme RoomEnvironment, réglé pour la DA : grands panneaux blancs doux + bandes cramoisies) */
  function studio(T, renderer) {
    const sc = new T.Scene(), box = new T.BoxGeometry(1, 1, 1);
    const room = new T.Mesh(new T.BoxGeometry(12, 8, 12), new T.MeshStandardMaterial({ color: 0x050507, side: T.BackSide, roughness: 1 }));
    sc.add(room);
    const panel = (color, intensity, x, y, z, sx, sy, sz) => { const m = new T.Mesh(box, new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(intensity) })); m.position.set(x, y, z); m.scale.set(sx, sy, sz); sc.add(m); };
    panel(0xffffff, 2.4, 0, 3.9, 0, 5, 0.1, 3);           // softbox au plafond
    panel(0xffffff, 0.8, -5.9, 1.5, 0, 0.1, 2.0, 5);       // panneau latéral gauche
    panel(0xef1748, 3.0, 5.9, 0.6, 0, 0.1, 1.2, 8);        // bande cramoisie à droite
    panel(0xef1748, 2.2, 0, 0.4, -5.9, 8, 0.6, 0.1);       // bande cramoisie au fond
    panel(0x1acfd6, 0.8, 0, 2.5, 5.9, 3, 0.5, 0.1);        // touche cyan (ETO)
    const pm = new T.PMREMGenerator(renderer), rt = pm.fromScene(sc, 0.03); pm.dispose();
    return rt.texture;
  }

  /** matériaux de la DA */
  G3.mats = (T) => ({
    obsidian: new T.MeshPhysicalMaterial({ color: 0x0a0b0e, roughness: 0.16, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06, reflectivity: 0.6 }),
    graphite: new T.MeshStandardMaterial({ color: 0x1b1c23, roughness: 0.55, metalness: 0.35 }),
    metal: new T.MeshStandardMaterial({ color: 0x9a9ba3, roughness: 0.28, metalness: 1 }),
    gold: new T.MeshStandardMaterial({ color: 0xe8b54a, roughness: 0.22, metalness: 1 }),
    ivory: new T.MeshPhysicalMaterial({ color: 0xf1e8d8, roughness: 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.15 }),
    crimsonGloss: new T.MeshPhysicalMaterial({ color: 0x9e0b26, roughness: 0.2, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08 }),
    neonRed: new T.MeshStandardMaterial({ color: 0xff3d63, emissive: 0xef1748, emissiveIntensity: 2.4, roughness: 0.4 }),
    neonCyan: new T.MeshStandardMaterial({ color: 0x7ff6fb, emissive: 0x1acfd6, emissiveIntensity: 2.2, roughness: 0.4 }),
    feltRed: new T.MeshStandardMaterial({ color: 0x5c0716, roughness: 0.95, metalness: 0 }),
    feltDark: new T.MeshStandardMaterial({ color: 0x101116, roughness: 0.95, metalness: 0 }),
  });

  /** boîte aux arêtes arrondies (plateaux, tables, palets) : profil extrudé avec biseau */
  G3.roundedBox = (T, w, h, d, r, seg) => {
    r = Math.min(r, w / 2 - 1e-3, d / 2 - 1e-3); const s = new T.Shape(), x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const bev = Math.min(r * 0.6, h * 0.3);
    const g = new T.ExtrudeGeometry(s, { depth: h - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: seg || 4, curveSegments: 10 });
    g.rotateX(-Math.PI / 2); g.translate(0, -h / 2 + bev, 0); g.computeVertexNormals();
    return g;
  };
  /** palet / pion : cylindre au bord arrondi (profil tourné) */
  G3.disc = (T, radius, height, bevel, seg) => {
    const b = Math.min(bevel || height * 0.3, radius * 0.4, height / 2), pts = [new T.Vector2(0, 0)];
    for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2); pts.push(new T.Vector2(radius - b + Math.cos(a) * b, b + Math.sin(a) * b)); }
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); pts.push(new T.Vector2(radius - b + Math.cos(a) * b, height - b + Math.sin(a) * b)); }
    pts.push(new T.Vector2(0, height));
    return new T.LatheGeometry(pts, seg || 48);
  };
  /** texture dessinée sur un canvas (motifs, logos, numéros) */
  G3.canvasTex = (T, w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return t; };
  /** images des textures en data: (js/games/img_pack_<nom>.js) : une image file:// salit le canvas et la texture WebGL reste noire dans l'application */
  const packs = {};
  G3.pack = (name) => packs[name] || (packs[name] = new Promise((res) => { const s = document.createElement("script"); s.src = (G3.base || "") + "js/games/img_pack_" + name + ".js"; s.onload = res; s.onerror = res; document.head.appendChild(s); }));
  G3.src = (url) => (window.ENOS_IMG && window.ENOS_IMG[url]) || url;
  G3.loadTex = (T, url) => new Promise((res) => { new T.TextureLoader().load(G3.src(url), (t) => { t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, () => res(null)); });

  /**
   * crée une scène dans `host` : {T, renderer, scene, camera, mats, add, pick(x,y,objects), onFrame(fn), dispose()}
   * o : {fov, cam:[x,y,z], look:[x,y,z], fog, shadows, bg}
   */
  G3.stage = async (host, o) => {
    o = o || {};
    const T = await G3.ready();
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = o.exposure || 1.05;
    renderer.shadowMap.enabled = o.shadows !== false; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.domElement.className = "g3-canvas"; host.appendChild(renderer.domElement);
    const scene = new T.Scene(); scene.background = new T.Color(o.bg != null ? o.bg : 0x07080b);
    scene.fog = new T.FogExp2(o.bg != null ? o.bg : 0x050507, o.fog != null ? o.fog : 0.045);
    scene.environment = studio(T, renderer);
    const camera = new T.PerspectiveCamera(o.fov || 40, 1, 0.05, 200); const cam = o.cam || [0, 9, 9]; camera.position.set(cam[0], cam[1], cam[2]);
    const look = new T.Vector3(...(o.look || [0, 0, 0])); camera.lookAt(look);
    // éclairage : clé chaude douce (ombres), contre-jour cramoisi, remplissage froid
    const key = new T.DirectionalLight(0xfff1e6, 2.2); key.position.set(-4, 10, 6); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 8; key.shadow.camera.bottom = -8; key.shadow.bias = -0.0004; key.shadow.radius = 4;
    const rim = new T.PointLight(0xef1748, 40, 30, 2); rim.position.set(5, 3, -5);
    const rim2 = new T.PointLight(0xef1748, 22, 30, 2); rim2.position.set(-6, 2.5, -4);
    const fill = new T.HemisphereLight(0x9fb4ff, 0x1a0508, 0.35);
    scene.add(key, rim, rim2, fill);
    const mats = G3.mats(T), frames = [], ray = new T.Raycaster(), v2 = new T.Vector2();
    let alive = true, raf = 0, last = performance.now();
    let composer = null, bloom = null;
    // travelling d'ouverture : la caméra arrive en tournant depuis une vue rasante jusqu'à la pose de jeu
    const intro = o.intro ? { k: 0, d: o.intro.d || 2.2, yaw: o.intro.yaw == null ? 0.9 : o.intro.yaw, zoom: o.intro.zoom || 0.75, low: o.intro.low || 0.35, p1: null, q1: null, live: false } : null;
    const size = () => { const w = host.clientWidth || 360, h = host.clientHeight || 640; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (o.fit) o.fit(camera, w / h); if (intro) { intro.p1 = camera.position.clone(); intro.q1 = camera.quaternion.clone(); } if (composer) composer.setSize(w, h); };
    const ro = window.ResizeObserver ? new ResizeObserver(size) : null; if (ro) ro.observe(host); else window.addEventListener("resize", size); size();
    const shake = { a: 0, d: 0, t: 0 }, camOff = new T.Vector3();
    const loop = (t) => { if (!alive) return; const dt = Math.min(0.05, (t - last) / 1000); last = t; frames.forEach((f) => f(dt, t / 1000));
      if (shake.t > 0) { shake.t = Math.max(0, shake.t - dt); const k = shake.a * (shake.t / shake.d); camOff.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k * 0.6, (Math.random() - 0.5) * k); camera.position.add(camOff); }
      if (intro && intro.k < 1) { intro.k = Math.min(1, intro.k + dt / intro.d); const e = intro.k < 0.5 ? 4 * intro.k ** 3 : 1 - Math.pow(-2 * intro.k + 2, 3) / 2;
        const fwd = new T.Vector3(0, 0, -1).applyQuaternion(intro.q1), dist = intro.p1.length() || 10, tgt = intro.p1.clone().add(fwd.multiplyScalar(dist));
        const p0 = intro.p1.clone().sub(tgt).applyAxisAngle(new T.Vector3(0, 1, 0), intro.yaw).multiplyScalar(intro.zoom).add(tgt); p0.y = tgt.y + (intro.p1.y - tgt.y) * intro.low;
        camera.position.lerpVectors(p0, intro.p1, e); camera.lookAt(tgt); intro.live = true; }
      else if (intro && intro.live) { camera.position.copy(intro.p1); camera.quaternion.copy(intro.q1); intro.live = false; }
      if (composer) composer.render(dt); else renderer.render(scene, camera);
      if (shake.t > 0 || camOff.lengthSq()) { camera.position.sub(camOff); camOff.set(0, 0, 0); }
      raf = requestAnimationFrame(loop); };
    // bloom (halo lumineux des néons, traînées, éclats) : chargé avec les extras, demi-résolution pour rester fluide sur téléphone
    if (o.bloom && G3.fx()) G3.extras().then((X) => { if (!X || !alive || !X.EffectComposer) return;
      composer = new X.EffectComposer(renderer); composer.addPass(new X.RenderPass(scene, camera));
      const w = host.clientWidth || 360, h = host.clientHeight || 640; bloom = new X.UnrealBloomPass(new T.Vector2(w / 2, h / 2), o.bloom.strength || 0.55, o.bloom.radius || 0.5, o.bloom.threshold == null ? 0.82 : o.bloom.threshold);
      composer.addPass(bloom); composer.addPass(new X.OutputPass()); composer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); composer.setSize(w, h); }).catch(() => {});
    raf = requestAnimationFrame(loop);
    return {
      T, renderer, scene, camera, mats, key, rim, look,
      add: (...x) => scene.add(...x),
      onFrame: (fn) => frames.push(fn),
      /** objets touchés sous le point (coordonnées écran) */
      pick: (x, y, objects) => { const r = renderer.domElement.getBoundingClientRect(); v2.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(v2, camera); return ray.intersectObjects(objects, true); },
      /** point du plan horizontal y = h sous le doigt */
      ground: (x, y, h) => { const r = renderer.domElement.getBoundingClientRect(); v2.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(v2, camera); const p = new T.Vector3(); return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -(h || 0)), p) ? p : null; },
      size,
      /** secousse de caméra (amplitude en unités de scène, durée en s) */
      /** vrai pendant le travelling d'ouverture (les étiquettes projetées à l'écran doivent suivre) */
      introActive: () => !!(intro && (intro.k < 1 || intro.live)),
      shake: (a, d) => { if (a > shake.a * (shake.t / (shake.d || 1))) { shake.a = a; shake.d = d || 0.4; shake.t = shake.d; } },
      bloom: () => bloom,
      dispose: () => { alive = false; cancelAnimationFrame(raf); if (ro) ro.disconnect(); scene.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) [].concat(m.material).forEach((x) => { if (x.map) x.map.dispose(); x.dispose(); }); }); renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); renderer.domElement.remove(); },
    };
  };
  /** fond de scène : dôme sombre avec halo cramoisi bas (la « brume rouge » de la DA) + sol mat très sombre */
  G3.backdrop = (S, o) => {
    o = o || {}; const T = S.T;
    const tex = G3.canvasTex(T, 1024, 512, (g, w, h) => {
      g.fillStyle = "#050507"; g.fillRect(0, 0, w, h);
      const r = g.createRadialGradient(w * 0.5, h * 0.62, 10, w * 0.5, h * 0.62, h * 0.75); r.addColorStop(0, "rgba(150,10,40,0.85)"); r.addColorStop(0.35, "rgba(90,6,24,0.55)"); r.addColorStop(1, "rgba(5,5,7,0)"); g.fillStyle = r; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 40; k++) { const x = Math.random() * w, y = h * (0.35 + Math.random() * 0.5), rr = 40 + Math.random() * 140; const q = g.createRadialGradient(x, y, 0, x, y, rr); q.addColorStop(0, `rgba(239,23,72,${0.03 + Math.random() * 0.05})`); q.addColorStop(1, "rgba(239,23,72,0)"); g.fillStyle = q; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    });
    const dome = new T.Mesh(new T.SphereGeometry(60, 48, 24), new T.MeshBasicMaterial({ map: tex, side: T.BackSide, fog: false, toneMapped: false })); S.add(dome);
    const floor = new T.Mesh(new T.CircleGeometry(40, 64), new T.MeshStandardMaterial({ color: 0x060608, roughness: 0.9, metalness: 0, envMapIntensity: 0.15 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = o.y != null ? o.y : -0.62; floor.receiveShadow = true; S.add(floor);
    if (o.glow) {                                                     // halo cramoisi sous l'objet principal
      const gt = G3.canvasTex(T, 256, 256, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, "rgba(239,23,72,0.55)"); r.addColorStop(0.5, "rgba(239,23,72,0.18)"); r.addColorStop(1, "rgba(239,23,72,0)"); g.fillStyle = r; g.fillRect(0, 0, w, h); });
      const gl = new T.Mesh(new T.PlaneGeometry(o.glow, o.glow), new T.MeshBasicMaterial({ map: gt, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
      gl.rotation.x = -Math.PI / 2; gl.position.y = floor.position.y + 0.01; S.add(gl);
    }
    return { dome, floor };
  };
  /** effets lourds (bloom, particules denses) : réglage « games.fx » (true par défaut) */
  G3.fx = () => { try { return E.settings.get("games.fx", true) !== false; } catch (e) { return true; } };
  let extrasP = null;
  /** extras three.js (GLTFLoader + décodeur meshopt + post-traitement), chargés à la demande : vendor/three_extras.js */
  G3.extras = () => extrasP || (extrasP = G3.ready().then((T) => (T.GLTFLoader ? T : new Promise((res) => { const s = document.createElement("script"); s.src = (G3.base || "") + "vendor/three_extras.js"; s.onload = () => res(window.THREE.GLTFLoader ? window.THREE : null); s.onerror = () => { extrasP = null; res(null); }; document.head.appendChild(s); }))));
  /** charge un modèle .glb (compressé meshopt possible) ; résout la scène ou null */
  //   key : nom du modèle embarqué dans js/games/glb_<key>.js (base64 : la WebView en file:// ne permet pas fetch des fichiers binaires)
  G3.loadGLB = async (key) => { const X = await G3.extras(); if (!X) return null;
    const store = () => window.ENOS_GLB && window.ENOS_GLB[key];
    if (!store()) await new Promise((res) => { const s = document.createElement("script"); s.src = (G3.base || "") + "js/games/glb_" + key + ".js"; s.onload = res; s.onerror = res; document.head.appendChild(s); });
    const b64 = store(); if (!b64) return null;
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const L = new X.GLTFLoader(); if (X.MeshoptDecoder) L.setMeshoptDecoder(X.MeshoptDecoder);
    // textures par <img> (la politique de sécurité de l'app interdit fetch, y compris sur les blob:)
    L.register((parser) => { parser.textureLoader = new X.TextureLoader(parser.options.manager); return { name: "enos_img_textures" }; });
    return new Promise((res) => { try { L.parse(u.buffer, "", (g) => res(g.scene), () => res(null)); } catch (e) { res(null); } }); };
  /**
   * particules qui tombent et dérivent au vent (pétales, feuilles, neige, poussière) : instances de petits plans qui tournoient.
   * o : {count, tex, colors:[...], size:[min,max], area:[x0,x1,z0,z1], y:[min,max], fall, wind:{x,z}, gust, spin, ground, additive}
   */
  G3.particles = (S, o) => {
    const T = S.T, n = G3.fx() ? o.count : Math.round(o.count / 3), geo = new T.PlaneGeometry(1, 1);
    const mat = new T.MeshStandardMaterial({ map: o.tex || null, transparent: true, alphaTest: o.tex ? 0.2 : 0, side: T.DoubleSide, depthWrite: !o.additive, roughness: 0.8, blending: o.additive ? T.AdditiveBlending : T.NormalBlending, emissive: o.emissive || 0x000000, emissiveIntensity: o.emissiveIntensity || 0 });
    const im = new T.InstancedMesh(geo, mat, n); im.frustumCulled = false; im.castShadow = !!o.shadow;
    const [x0, x1, z0, z1] = o.area, [y0, y1] = o.y, P = [], dummy = new T.Object3D(), col = new T.Color();
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < n; i++) { P.push({ x: rnd(x0, x1), y: rnd(y0, y1), z: rnd(z0, z1), s: rnd(o.size[0], o.size[1]), rx: rnd(0, 6), ry: rnd(0, 6), rz: rnd(0, 6), vr: rnd(0.6, 2.2) * (o.spin || 1), ph: rnd(0, 6), f: rnd(0.6, 1.3), rest: 0 });
      if (o.colors) im.setColorAt(i, col.set(o.colors[i % o.colors.length])); }
    S.add(im); let wt = 0;
    const api = { mesh: im, gust: 0, wind: Object.assign({ x: 0.4, z: 0.1 }, o.wind || {}),
      update: (dt) => { wt += dt; const gust = 1 + api.gust + Math.sin(wt * 0.7) * 0.35 + Math.sin(wt * 1.9) * 0.15; api.gust *= Math.pow(0.4, dt);
        for (let i = 0; i < n; i++) { const p = P[i];
          if (p.rest > 0) { p.rest -= dt; if (p.rest <= 0) { p.y = y1; p.x = rnd(x0, x1); p.z = rnd(z0, z1); } }
          else { p.y -= (o.fall || 0.5) * p.f * dt; p.x += (api.wind.x * gust + Math.sin(wt * 1.3 + p.ph) * 0.25) * dt; p.z += (api.wind.z * gust + Math.cos(wt * 1.1 + p.ph) * 0.15) * dt;
            p.rx += p.vr * dt * gust; p.rz += p.vr * 0.7 * dt; if (p.y < (o.ground == null ? y0 : o.ground)) { p.y = o.ground == null ? y0 : o.ground; p.rest = o.ground == null ? 0.01 : rnd(1.5, 5); p.rx = -Math.PI / 2; }
            if (p.x > x1) p.x = x0; if (p.x < x0) p.x = x1; if (p.z > z1) p.z = z0; if (p.z < z0) p.z = z1; }
          dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.rx, p.ry, p.rz); dummy.scale.setScalar(p.s); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); }
        im.instanceMatrix.needsUpdate = true; } };
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return api;
  };
  /**
   * traînée de vitesse derrière un objet : ruban qui suit les dernières positions, plus large et plus lumineux quand ça va vite.
   * o : {color, len (points), width, y, max (vitesse de saturation)}
   */
  G3.trail = (S, o) => {
    const T = S.T, N = o.len || 26, pos = new Float32Array(N * 2 * 3), colA = new Float32Array(N * 2 * 4), idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.BufferAttribute(pos, 3)); geo.setAttribute("color", new T.BufferAttribute(colA, 4)); geo.setIndex(idx);
    const mat = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false });
    const mesh = new T.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 5; S.add(mesh);
    const pts = [], c = new T.Color(o.color || 0xff3d63);
    return { mesh, color: c,
      push: (x, z, speed) => {
        const k = Math.min(1, speed / (o.max || 10)); pts.unshift({ x, z, k }); if (pts.length > N) pts.pop();
        for (let i = 0; i < N; i++) { const p = pts[Math.min(i, pts.length - 1)] || { x, z, k: 0 }, q = pts[Math.min(i + 1, pts.length - 1)] || p;
          let dx = p.x - q.x, dz = p.z - q.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
          const f = 1 - i / (N - 1), w = (o.width || 0.3) * f * (0.25 + p.k * 0.75), y = o.y || 0.12, a = i * 6;
          pos[a] = p.x - dz * w; pos[a + 1] = y; pos[a + 2] = p.z + dx * w; pos[a + 3] = p.x + dz * w; pos[a + 4] = y; pos[a + 5] = p.z - dx * w;
          const al = f * f * p.k * (i < pts.length ? 1 : 0), b = i * 8; for (const off of [0, 4]) { colA[b + off] = c.r * al; colA[b + off + 1] = c.g * al; colA[b + off + 2] = c.b * al; colA[b + off + 3] = al; } }
        geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; },
      clear: () => { pts.length = 0; colA.fill(0); geo.attributes.color.needsUpdate = true; } };
  };
  /** interpolation douce */
  G3.tween = (dur, fn, ease) => new Promise((res) => { const t0 = performance.now(), e = ease || ((k) => 1 - Math.pow(1 - k, 3)); const st = (t) => { const k = Math.min(1, (t - t0) / (dur * 1000)); fn(e(k)); if (k < 1) requestAnimationFrame(st); else res(); }; requestAnimationFrame(st); });
})();
