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
  G3.loadTex = (T, url) => new Promise((res) => { new T.TextureLoader().load(url, (t) => { t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, () => res(null)); });

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
    const size = () => { const w = host.clientWidth || 360, h = host.clientHeight || 640; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (o.fit) o.fit(camera, w / h); };
    const ro = window.ResizeObserver ? new ResizeObserver(size) : null; if (ro) ro.observe(host); else window.addEventListener("resize", size); size();
    const loop = (t) => { if (!alive) return; const dt = Math.min(0.05, (t - last) / 1000); last = t; frames.forEach((f) => f(dt, t / 1000)); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
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
  /** interpolation douce */
  G3.tween = (dur, fn, ease) => new Promise((res) => { const t0 = performance.now(), e = ease || ((k) => 1 - Math.pow(1 - k, 3)); const st = (t) => { const k = Math.min(1, (t - t0) / (dur * 1000)); fn(e(k)); if (k < 1) requestAnimationFrame(st); else res(); }; requestAnimationFrame(st); });
})();
