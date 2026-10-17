"use strict";
// VISAGE D'ETO — 8-BIT. Une boule perlée en pixel-art (sprites 64x64 dessinés par godot_chess/preparer_eto8.py, atlas partagé avec les plateaux Godot),
// 57 émotions, chacune avec son MOUVEMENT (secousses, rebonds, balancement), clignements, regard au pixel entier, bouche qui parle sur 4 niveaux,
// effets animés (cœurs, étincelles, zzz, ?, !, larmes, aura, notes…) et un « pouf » de pixels à chaque changement d'émotion.
//   const f = EtoFace.mount(element);       f.set("happy");       f.react("laugh", 1800);      f.speaking(true);      f.look(0.5, -0.2);
//   EtoFace.setAll("thinking");             EtoFace.fromTags(["hmm"]);                         EtoFace.guess("Bravo, bien joué !")
(() => {
  const S = 64;
  let IDX = null, ATLAS = null, loading = null, uid = 0;
  const faces = new Set();
  const pointer = { x: -1, y: -1, t: 0 };
  addEventListener("pointermove", (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.t = performance.now(); }, { passive: true });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function load() {
    if (IDX && ATLAS) return Promise.resolve(IDX);
    return (loading = loading || Promise.all([
      fetch("/static/eto8_index.json").then((r) => r.json()),
      new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = "/static/eto8_atlas.png"; }),
    ]).then(([j, im]) => { IDX = j; ATLAS = im; return j; }));
  }
  const cell = (i) => [(i % IDX.cols) * S, Math.floor(i / IDX.cols) * S];

  class Face {
    constructor(host, opts = {}) {
      this.host = host; this.n = ++uid;
      this.base = "neutral"; this.temp = null; this.tempUntil = 0; this.speak = false; this.lvl = -1;
      this.lookT = { x: 0, y: 0 }; this.lookC = { x: 0, y: 0 }; this.follow = opts.follow !== false;
      this.blinkAt = performance.now() + 1800; this.blinkStep = -1; this.blinkT = 0;
      this.glanceAt = performance.now() + 5000; this.glance = null; this.glanceEnd = 0;
      this.popT = -1; this.talkPhase = 0; this.talkT = 0;
      host.classList.add("eto-face");
      host.innerHTML = "";
      const c = this.cv = document.createElement("canvas");
      c.width = S; c.height = S;
      c.setAttribute("role", "img"); c.setAttribute("aria-label", "Visage d'ETO");
      c.style.cssText = "width:100%;height:100%;display:block;image-rendering:pixelated;image-rendering:crisp-edges;object-fit:contain";
      host.appendChild(c);
      this.ctx = c.getContext("2d");
      this.ctx.imageSmoothingEnabled = false;
      faces.add(this);
      load().then(() => ensureLoop());
    }
    // ---- API (identique à l'ancien visage vectoriel)
    set(name) { if (!IDX) { this.base = name; return this; } if (!IDX.expr[name]) name = "neutral"; if (name !== this.base && !this.temp) this.popT = 0; this.base = name; return this; }
    react(name, ms = 1700) { if (!IDX || !IDX.expr[name]) return this; this.temp = name; this.tempUntil = performance.now() + ms; this.popT = 0; return this; }
    look(x, y) { this.lookT = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) }; this.follow = false; return this; }
    followPointer(on = true) { this.follow = on; return this; }
    speaking(on) { this.speak = !!on; if (!on) this.lvl = -1; return this; }
    level(v) { this.lvl = clamp(v, 0, 1); return this; }
    destroy() { faces.delete(this); this.host.innerHTML = ""; }

    blit(i, dx, dy) { const [sx, sy] = cell(i); this.ctx.drawImage(ATLAS, sx, sy, S, S, Math.round(dx), Math.round(dy), S, S); }

    frame(now, dt) {
      if (!IDX || !ATLAS) return;
      if (this.temp && now > this.tempUntil) this.temp = null;
      const name = this.temp || this.base, E = IDX.expr[name] || IDX.expr.neutral, t = now / 1000;
      // clignement : 5 images (ouvert, mi-clos, fermé, mi-clos, ouvert), une image toutes les 55 ms
      if (this.blinkStep < 0 && now > this.blinkAt) { this.blinkStep = 0; this.blinkT = now; this.blinkAt = now + 2400 + Math.random() * 3800; if (Math.random() < 0.18) this.blinkAt = now + 260; }   // parfois un double clignement
      let blink = 0;
      if (this.blinkStep >= 0) { const k = Math.floor((now - this.blinkT) / 55); blink = [0, 1, 2, 1, 0][k] || 0; if (k >= 5) this.blinkStep = -1; }
      // regard : pointeur, coups d'œil, ou consigne ; toujours un DÉCALAGE ENTIER en pixels (le visage « tourne » sur la boule)
      let gx = 0, gy = 0;
      if (this.follow && now - pointer.t < 6000) {
        const r = this.cv.getBoundingClientRect();
        if (r.width) { gx = clamp((pointer.x - (r.left + r.width / 2)) / (innerWidth * 0.4), -1, 1); gy = clamp((pointer.y - (r.top + r.height / 2)) / (innerHeight * 0.4), -1, 1); }
      } else if (this.follow) {
        if (now > this.glanceAt) { this.glance = { x: Math.random() * 1.6 - 0.8, y: Math.random() * 0.8 - 0.4 }; this.glanceAt = now + 3500 + Math.random() * 5000; this.glanceEnd = now + 700 + Math.random() * 700; }
        if (this.glance && now < this.glanceEnd) { gx = this.glance.x; gy = this.glance.y; }
      } else { gx = this.lookT.x; gy = this.lookT.y; }
      const lk = 1 - Math.exp(-dt * 14);
      this.lookC.x += (gx - this.lookC.x) * lk; this.lookC.y += (gy - this.lookC.y) * lk;
      const lox = Math.round(this.lookC.x * 3), loy = Math.round(this.lookC.y * 2);
      // parole : bouche sur 4 niveaux, enveloppe syllabique (ou level()), changement toutes les ~70 ms comme un vrai sprite d'époque
      let phase = 0;
      if (this.speak) {
        if (now - this.talkT > 70) {
          this.talkT = now;
          const env = this.lvl >= 0 ? this.lvl : Math.max(0, Math.abs(Math.sin(t * 9.2) * 0.55 + Math.sin(t * 5.1 + 1.3) * 0.35 + Math.sin(t * 13.7) * 0.18) - 0.1) * (Math.sin(t * 1.7) > -0.82 ? 1 : 0.15);
          this.talkPhase = env < 0.12 ? 0 : env < 0.3 ? 1 : env < 0.5 ? 2 : 3;
        }
        phase = this.talkPhase;
      }
      // mouvement propre à l'émotion : hz >= 6 secousse (alternance), sinon rebond / balancement
      let mx = 0, my = 0;
      const M = E.mot;
      if (M) {
        const hz = M.hz || 1;
        if (hz >= 6) { mx = (M.x || 0) * (Math.sin(t * hz * 6.2832) > 0 ? 1 : -1); my = (M.y || 0) * (Math.sin(t * hz * 6.2832 + 1.3) > 0.2 ? -1 : 0); }
        else if (hz >= 2.5) { my = -Math.round((M.y || 0) * Math.abs(Math.sin(t * hz * Math.PI))); mx = Math.round((M.x || 0) * Math.sin(t * hz * 6.2832)); }
        else { mx = Math.round((M.x || 0) * Math.sin(t * hz * 6.2832)); my = Math.round((M.y || 0) * Math.sin(t * hz * 6.2832 + 0.7)); }
      }
      const breath = Math.sin(t * 1.9) > 0.45 ? 1 : 0;                       // respiration : la boule descend d'un pixel, par paliers
      // « pouf » : petit saut + éclat de pixels quand l'émotion change
      let popY = 0, popFrame = -1;
      if (this.popT >= 0) { this.popT += dt; const k = Math.floor(this.popT / 0.05); popFrame = k; popY = [-3, -2, -1, 0, 0][Math.min(k, 4)] || 0; if (k >= 5) this.popT = -1; }
      const bx = mx, by = my + breath + popY;
      // ---- dessin (ordre : ombre, corps, haut du visage, bouche, effets)
      const ctx = this.ctx;
      ctx.clearRect(0, 0, S, S);
      this.blit(IDX.shadow[(by < 0) ? 1 : 0], 0, 0);
      this.blit(IDX.body, bx, by);
      this.blit(E.top[blink], bx + lox, by + loy);
      this.blit(E.mouth[phase], bx + lox, by + loy);
      const frameN = Math.floor(t * 8);
      for (const f of E.fx) { const fr = IDX.fx[f]; if (fr) this.blit(fr[frameN % fr.length], f === "ring" || f === "aura" ? bx : 0, f === "ring" || f === "aura" ? by : 0); }
      if (popFrame >= 0 && popFrame < IDX.fx.pop.length) this.blit(IDX.fx.pop[popFrame], bx, by);
    }
  }

  // ---------------------------------------------------------------- boucle commune (~30 images/s : le rythme d'un vrai jeu 8-bit)
  let raf = 0, last = 0;
  function loop(now) {
    raf = 0;
    if (!faces.size) return;
    if (now - last >= 33) {
      const dt = Math.min(0.1, (now - last) / 1000 || 0.033); last = now;
      if (!document.hidden) faces.forEach((f) => {
        if (!f.host.isConnected) { faces.delete(f); return; }
        if (f.host.getBoundingClientRect().width > 0) f.frame(now, dt);
      });
    }
    raf = requestAnimationFrame(loop);
  }
  function ensureLoop() { if (!raf && faces.size) { last = 0; raf = requestAnimationFrame(loop); } }

  // ---------------------------------------------------------------- balises audio / texte -> expression
  const TAG = { shouts: "excited", screams: "panic", excited: "excited", hmm: "hmm", sigh: "sigh", laugh: "laugh", chuckles: "chuckle", chuckle: "chuckle", "clears throat": "awkward", exhales: "relieved", whispers: "shy",
    gasps: "surprised", coughs: "awkward", gulps: "nervous", whistles: "cool", applause: "victory", cheers: "hyped", sarcastic: "smug", curious: "curious", surprised: "surprised", happy: "happy", sad: "sad", pause: "hmm" };
  function fromTags(tags) { const t = (tags || []).map((x) => TAG[String(x).toLowerCase().trim()]).filter(Boolean); return t.length ? t : null; }
  function guess(text) {
    const s = String(text || "").toLowerCase();
    if (/(haha|mdr|lol|ptdr|hihi)/.test(s)) return "lol";
    if (/(gg|victoire|j'ai gagné|on a gagné|champion)/.test(s)) return "victory";
    if (/(bravo|félicit|felicit|congrat|bien joué|well played|superbe|magnifique)/.test(s)) return "impressed";
    if (/(merci|thank)/.test(s)) return "touched";
    if (/(je t'aime|love you|adore)/.test(s)) return "love";
    if (/(énervé|enerve|rage|furieux|angry|nul !|honte)/.test(s)) return "angry";
    if (/(peur|flippe|panique|scared|help)/.test(s)) return "scared";
    if (/(désolé|desole|pardon|sorry|malheureusement|unfortunately)/.test(s)) return "worried";
    if (/(erreur|error|échec|impossible|problème|probleme)/.test(s)) return "worried";
    if (/(facile|trop fort|evidemment|évidemment|bien sûr|obviously)/.test(s)) return "smug";
    if (/(zzz|fatigu|sommeil|tired|sleepy)/.test(s)) return "tired";
    if (/\?\s*$/.test(s)) return "curious";
    if (/!\s*$/.test(s)) return "happy";
    return "smile";
  }
  window.EtoFace = {
    mount(host, opts) { const f = new Face(host, opts); f.set(opts && opts.expression || "neutral"); return f; },
    all: faces, load, fromTags, guess,
    setAll(name) { faces.forEach((f) => f.set(name)); },
    reactAll(name, ms) { faces.forEach((f) => f.react(name, ms)); },
    speakingAll(on) { faces.forEach((f) => f.speaking(on)); },
    get names() { return IDX ? Object.keys(IDX.expr) : []; },
  };
  load();
})();
