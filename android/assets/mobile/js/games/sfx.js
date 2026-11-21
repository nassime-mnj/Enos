"use strict";
// SONS DES JEUX (Web Audio) : un seul gestionnaire pour tous les mini-jeux.
//   - banque : js/games/sfx_bank.js (événement -> variantes, bus, volume, plage de hauteur, polyphonie) ; sons : js/games/sfx_data.js (chargé à l'ouverture d'un jeu)
//   - bus : sfx, ui, music, amb -> master -> compresseur doux (pas d'écrêtage quand plusieurs chocs tombent ensemble)
//   - chaque lecture : variante différente de la précédente, hauteur légèrement aléatoire, volume selon l'intensité du choc, panoramique selon la position
//   - polyphonie limitée par événement et écart minimal (pas de mitraille de 10 sons identiques), ambiances en boucle avec fondu
//   - réglages : E.settings "games.sound" (marche/arrêt) et "games.vol.<bus>" (0..1)
(() => {
  const E = window.ENOS;
  const A = (E.gsfx = {});
  const BANK = () => window.ENOS_GSFX_BANK || {};
  const DEF = { sfx: 1, ui: 0.8, music: 0.8, amb: 0.55 };
  let ctx = null, master = null, buses = {}, dataP = null;
  const bufs = new Map(), lastVar = {}, lastAt = {}, active = {}, loops = {};
  const setting = (k, d) => { try { return E.settings ? E.settings.get(k, d) : d; } catch (e) { return d; } };
  A.enabled = () => setting("games.sound", true) !== false;
  A.ctx = () => {
    if (ctx) return ctx;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    ctx = (E.chessSound && E.chessSound.ac && E.chessSound.ac()) || new C();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2; comp.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp);
    for (const b of Object.keys(DEF)) { const g = ctx.createGain(); g.gain.value = +setting("games.vol." + b, DEF[b]); g.connect(master); buses[b] = g; }
    return ctx;
  };
  A.setVol = (bus, v) => { if (E.settings) E.settings.set("games.vol." + bus, v); if (buses[bus]) buses[bus].gain.value = v; };
  const unlock = () => { const c = A.ctx(); if (c && c.state === "suspended") c.resume().catch(() => {}); };
  ["pointerdown", "touchstart", "keydown"].forEach((t) => window.addEventListener(t, unlock, { passive: true }));
  /** charge les sons (une fois) */
  const loadData = () => dataP || (dataP = new Promise((res) => {
    if (window.ENOS_GSFX_DATA) return res(true);
    const s = document.createElement("script"); s.src = (E.assetBase || "") + "js/games/sfx_data.js"; s.onload = () => res(true); s.onerror = () => { dataP = null; res(false); }; document.head.appendChild(s);
  }));
  /** ambiances longues : fichier à part (js/games/sfx_<pack>_data.js), chargé seulement quand un décor en a besoin */
  const packP = {};
  const loadPack = (name) => packP[name] || (packP[name] = new Promise((res) => { const s = document.createElement("script"); s.src = (E.assetBase || "") + "js/games/sfx_" + name + "_data.js"; s.onload = () => res(true); s.onerror = () => { delete packP[name]; res(false); }; document.head.appendChild(s); }));
  const b64 = (s) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  const decode = (file) => {
    if (bufs.has(file)) return bufs.get(file);
    const c = A.ctx(), d = window.ENOS_GSFX_DATA && window.ENOS_GSFX_DATA[file];
    const p = !c || !d ? Promise.resolve(null) : new Promise((res) => { try { c.decodeAudioData(b64(d), res, () => res(null)); } catch (e) { res(null); } });
    const entry = { p, buf: null }; p.then((b) => (entry.buf = b)); bufs.set(file, entry); return entry;
  };
  /** précharge les événements dont le nom commence par un des préfixes (ex. ["ui", "end", "card", "chroma"]) */
  A.preload = async (prefixes) => {
    if (!(await loadData()) || !A.ctx()) return false;
    const evs = Object.keys(BANK()).filter((k) => prefixes.some((p) => k === p || k.startsWith(p + ".")));
    for (const p of new Set(evs.map((k) => BANK()[k].pack).filter(Boolean))) await loadPack(p);
    await Promise.all(evs.flatMap((k) => BANK()[k].files.map((f) => decode(f).p)));
    return true;
  };
  /**
   * joue un événement. o : {vol 0..1, intensity 0..1 (force du choc), rate (multiplie la hauteur), pan -1..1, delay (s), force (ignore l'écart minimal)}
   * renvoie true si un son est parti
   */
  A.play = (ev, o) => {
    o = o || {}; const e = BANK()[ev]; if (!e || !A.enabled()) return false;
    const c = A.ctx(); if (!c) return false; if (c.state === "suspended") c.resume().catch(() => {});
    const now = c.currentTime, poly = e.poly || 3;
    if (!o.force && lastAt[ev] && now - lastAt[ev] < 0.03) return false;
    active[ev] = (active[ev] || []).filter((s) => s.end > now);
    if (active[ev].length >= poly) return false;
    // variante : jamais deux fois la même d'affilée
    const n = e.files.length; let k = Math.floor(Math.random() * n); if (n > 1 && k === lastVar[ev]) k = (k + 1 + Math.floor(Math.random() * (n - 1))) % n;
    const entry = decode(e.files[k]); if (!entry.buf) { if (!dataP) A.preload([ev.split(".")[0]]); return false; }
    lastVar[ev] = k; lastAt[ev] = now;
    const src = c.createBufferSource(); src.buffer = entry.buf;
    const [lo, hi] = e.rate || [0.97, 1.03], inten = o.intensity == null ? 1 : Math.max(0, Math.min(1, o.intensity));
    src.playbackRate.value = (lo + Math.random() * (hi - lo)) * (o.rate || 1) * (0.94 + inten * 0.08);
    const g = c.createGain(); g.gain.value = (e.vol == null ? 1 : e.vol) * (o.vol == null ? 1 : o.vol) * (0.35 + 0.65 * inten);
    let node = g; src.connect(g);
    if (o.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)) * 0.7; g.connect(p); node = p; }
    node.connect(buses[e.bus] || buses.sfx);
    const t0 = now + (o.delay || 0); src.start(t0);
    active[ev].push({ end: t0 + entry.buf.duration / src.playbackRate.value });
    return true;
  };
  /** ambiance en boucle (fondu d'entrée) */
  A.loop = async (ev, o) => {
    o = o || {}; const e = BANK()[ev]; if (!e || !A.enabled() || loops[ev]) return;
    await A.preload([ev]); const c = A.ctx(); const entry = c && decode(e.files[0]); const buf = entry && (await entry.p); if (!buf || loops[ev]) return;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true; const g = c.createGain(); g.gain.value = 0;
    src.connect(g); g.connect(buses[e.bus] || buses.amb); src.start();
    g.gain.linearRampToValueAtTime((e.vol == null ? 1 : e.vol) * (o.vol == null ? 1 : o.vol), c.currentTime + (o.fade || 1.5));
    loops[ev] = { src, g };
  };
  A.stopLoop = (ev, fade) => { const l = loops[ev]; if (!l) return; delete loops[ev]; const c = A.ctx(), t = c.currentTime, f = fade == null ? 0.8 : fade;
    l.g.gain.cancelScheduledValues(t); l.g.gain.setValueAtTime(l.g.gain.value, t); l.g.gain.linearRampToValueAtTime(0, t + f); try { l.src.stop(t + f + 0.05); } catch (e) { /* déjà arrêtée */ } };
  A.stopAll = () => Object.keys(loops).forEach((k) => A.stopLoop(k, 0.4));
  A.has = (ev) => !!BANK()[ev];
})();
