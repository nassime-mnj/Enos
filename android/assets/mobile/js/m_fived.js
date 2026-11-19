"use strict";
// MODULE « 5D Chess » : accueil animé, partie contre ETO ou à deux, tutoriel interactif en 8 étapes. Règles : js/fived.js · rendu : js/fived_view.js.
(() => {
  const E = window.ENOS, FD = E.fived, esc = E.esc, $c = (t) => document.createElement(t);
  const SAVE = "fived.save", PREF = "fived.prefs";
  const SYMN = ["", "pion", "cavalier", "fou", "tour", "dame", "roi"];
  const E5 = ".....";
  const lname = (l) => "L" + (l > 0 ? "+" + l : l);
  const vib = (p) => { try { if (E.settings.get("fived.haptic", true) !== false && navigator.vibrate) navigator.vibrate(p); } catch (e) { /* rien */ } };

  // ------------------------------------------------------------------ sons synthétisés (WebAudio) : voyage dans le temps, nouvelle timeline, échec, victoire
  const Sfx = {
    a: null, on() { return E.settings.get("fived.sound", true) !== false; },
    ctx() { if (!this.a) { try { this.a = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } } if (this.a.state === "suspended") this.a.resume(); return this.a; },
    noise(a, dur) { const b = a.createBuffer(1, Math.max(1, (a.sampleRate * dur) | 0), a.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); return b; },
    play(kind) {
      if (!this.on()) return; const a = this.ctx(); if (!a) return; const t = a.currentTime, out = a.createGain(); out.gain.value = 0.5; out.connect(a.destination);
      const echo = a.createDelay(0.6); echo.delayTime.value = 0.23; const fb = a.createGain(); fb.gain.value = 0.38; echo.connect(fb); fb.connect(echo); const wet = a.createGain(); wet.gain.value = 0.45; echo.connect(wet); wet.connect(out);
      const tone = (type, f0, f1, dur, g0, dest, delay) => { const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t + (delay || 0)); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + (delay || 0) + dur); g.gain.setValueAtTime(0.0001, t + (delay || 0)); g.gain.exponentialRampToValueAtTime(g0, t + (delay || 0) + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + (delay || 0) + dur); o.connect(g); g.connect(dest || out); if (dest !== echo) g.connect(echo); o.start(t + (delay || 0)); o.stop(t + (delay || 0) + dur + 0.05); };
      const sweep = (f0, f1, dur, g0) => { const s = a.createBufferSource(); s.buffer = this.noise(a, dur); const f = a.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 3; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur); const g = a.createGain(); g.gain.value = g0; s.connect(f); f.connect(g); g.connect(out); g.connect(echo); s.start(t); };
      if (kind === "select") tone("sine", 660, 990, 0.12, 0.2);
      else if (kind === "move") tone("triangle", 320, 220, 0.14, 0.3);
      else if (kind === "jump") { sweep(300, 2400, 0.35, 0.6); tone("sine", 400, 1200, 0.35, 0.25); }
      else if (kind === "warp") { sweep(180, 3200, 0.7, 0.8); tone("sawtooth", 110, 880, 0.7, 0.16); tone("sine", 880, 220, 0.9, 0.18, null, 0.25); }
      else if (kind === "branch") { sweep(120, 4200, 0.9, 0.9); tone("sine", 55, 40, 1.0, 0.7); [523, 659, 784, 1047, 1319].forEach((f, i) => tone("triangle", f, f * 1.002, 0.5, 0.16, null, 0.35 + i * 0.07)); }
      else if (kind === "capture") { tone("square", 180, 60, 0.22, 0.28); tone("sine", 70, 35, 0.35, 0.6); }
      else if (kind === "check") { tone("sawtooth", 440, 330, 0.5, 0.2); tone("sawtooth", 466, 349, 0.5, 0.2); }
      else if (kind === "win") [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone("triangle", f, f, 0.7, 0.2, null, i * 0.11));
      else if (kind === "lose") [392, 349, 311, 262].forEach((f, i) => tone("sawtooth", f, f * 0.97, 0.7, 0.14, null, i * 0.18));
      else if (kind === "submit") { tone("sine", 440, 880, 0.18, 0.25); tone("sine", 880, 1320, 0.25, 0.2, null, 0.1); }
      else if (kind === "err") tone("square", 160, 110, 0.18, 0.15);
    },
  };

  // ------------------------------------------------------------------ tutoriel : positions
  const T = {
    // 1 : un échiquier normal (5×5) : Blancs R + R + K, Noir k
    one: () => FD.fromSetup({ W: 5, H: 5, turn: "w", tl: { 0: { t0: 0, boards: [["....k", E5, E5, E5, "R...K"]] } } }),
    // 3 : deux timelines au présent
    two: () => FD.fromSetup({ W: 5, H: 5, turn: "w", nW: 1, nB: 0, tl: {
      0: { t0: 0, boards: [["....k", E5, E5, E5, "R...K"]] },
      1: { t0: 0, by: "w", boards: [["k....", E5, E5, E5, "N...K"]] } } }),
    // 4 : sauter d'une timeline à l'autre
    jump: () => FD.fromSetup({ W: 5, H: 5, turn: "w", nW: 1, nB: 0, tl: {
      0: { t0: 0, boards: [["....k", E5, E5, E5, "R...K"]] },
      1: { t0: 0, by: "w", boards: [["....k", E5, E5, E5, "....K"]] } } }),
    // 5 : voyage dans le passé : la dame noire était en a1 à t=2
    past: () => FD.fromSetup({ W: 5, H: 5, turn: "w", tl: { 0: { t0: 0, boards: [
      ["....k", E5, E5, E5, "q..RK"], ["....k", E5, E5, E5, "q..RK"], ["....k", E5, E5, E5, "q..RK"],
      ["....k", E5, "q....", E5, "...RK"], ["....k", E5, "q....", E5, "R...K"]] } } }),
    // 6 : toutes les pièces, 2 timelines × 3 temps
    zoo: () => { const b = (rows) => rows, rows = ["....k", E5, "..P..", "..Q..", "RNB.K"]; const mk = () => [b(rows), b(rows), b(rows)]; return FD.fromSetup({ W: 5, H: 5, turn: "w", nW: 1, nB: 1, tl: { 0: { t0: 0, boards: mk() }, 1: { t0: 0, by: "w", boards: mk() }, "-1": { t0: 0, by: "b", boards: mk() } } }); },
    // 7 : échec par une dame d'une autre timeline
    check: () => FD.fromSetup({ W: 5, H: 5, turn: "w", nW: 1, nB: 0, tl: {
      0: { t0: 0, boards: [["k....", E5, E5, "....R", "....K"]] },
      1: { t0: 0, by: "w", boards: [["k....", E5, E5, "....q", E5]] } } }),
  };
  const STEPS = [
    { title: "Un échiquier… presque normal", setup: T.one, tasks: [
      { msg: "Voici un échiquier classique : touche la <b>tour</b> blanche, puis une case brillante.", hint: { sel: { l: 0, t: 0, x: 0, y: 0 } }, done: (S) => S.turnMoves.length > 0 },
      { msg: "Un <b>nouveau plateau</b> est apparu à droite : jouer un coup fait <b>avancer le temps</b>. Appuie sur <b>VALIDER</b> pour finir ton tour.", expect: "submit",
        reply: [{ l: 0, t: 1, x: 4, y: 4, to: { l: 0, t: 1, x: 3, y: 4 } }] }] },
    { title: "Le multivers", setup: null, tasks: [
      { msg: "Chaque <b>colonne</b> est un instant (T1, T2…), chaque <b>ligne</b> une <b>timeline</b> (L0, L+1…). Tu peux faire glisser et pincer pour explorer. Touche <b>🔭</b> pour tout voir.", expect: "next", overview: true }] },
    { title: "Plusieurs plateaux, un seul présent", setup: T.two, tasks: [
      { msg: "Deux timelines vivent au même instant. La <b>barre lumineuse « PRÉSENT »</b> montre où on joue : tu dois jouer sur <b>chaque plateau du présent</b>. Commence par <b>L0</b>.", hint: { sel: { l: 0, t: 0, x: 4, y: 0 } }, done: (S) => FD.latest(S, 0) > 0 },
      { msg: "Maintenant le plateau <b>L+1</b>.", hint: { sel: { l: 1, t: 0, x: 0, y: 0 } }, done: (S) => FD.latest(S, 1) > 0 },
      { msg: "Plus rien au présent : <b>VALIDE</b> ton tour.", expect: "submit", reply: null }] },
    { title: "Sauter d'un plateau à l'autre", setup: T.jump, tasks: [
      { msg: "Une pièce peut aussi se déplacer <b>entre les timelines</b> ! Déplace la <b>tour</b> de <b>L0</b> vers <b>L+1</b> (la case violette ◆ juste au-dessus d'elle).", hint: { sel: { l: 0, t: 0, x: 0, y: 0 }, target: { l: 1, t: 0, x: 0, y: 0 } }, expect: { from: { l: 0, t: 0, x: 0, y: 0 }, to: { l: 1, t: 0, x: 0, y: 0 } } },
      { msg: "Les <b>deux</b> plateaux ont avancé : la tour a quitté L0 et est apparue sur L+1. Les deux timelines continuent.", expect: "next" }] },
    { title: "Voyager dans le passé", setup: T.past, tasks: [
      { msg: "Là, c'est <b>fou</b> : une pièce peut <b>remonter dans le temps</b>. La dame noire était en a1 il y a deux coups (T2). Ta <b>tour</b> va la <b>capturer dans le passé</b> : touche-la, puis la case rose ⟲ sur le vieux plateau.", hint: { sel: { l: 0, t: 4, x: 0, y: 0 }, target: { l: 0, t: 2, x: 0, y: 0 } }, expect: { from: { l: 0, t: 4, x: 0, y: 0 }, to: { l: 0, t: 2, x: 0, y: 0 } } },
      { msg: "Bravo ! Une <b>nouvelle timeline (L+1)</b> est née : un univers parallèle où la dame n'existe plus. Le <b>présent a reculé</b> : c'est à ETO de jouer. <b>VALIDE</b>.", expect: "submit", reply: [{ l: 1, t: 3, x: 4, y: 4, to: { l: 1, t: 3, x: 3, y: 4 } }] },
      { msg: "ETO a répondu <b>dans la nouvelle timeline</b>. Le présent avance : à toi. Les coups dans le passé forcent l'adversaire à réagir ailleurs !", expect: "next" }] },
    { title: "Les pièces en 4D", setup: T.zoo, tasks: [
      { msg: "Chaque pièce se déplace sur <b>4 axes</b> : colonne, rangée, <b>temps</b> et <b>timeline</b>. Touche <b>chaque pièce</b> (dame, tour, fou, cavalier, pion) et observe ses cases. <span id='fd-kinds'></span>", kinds: ["q", "r", "b", "n", "p"], expect: "kinds" }] },
    { title: "Échec à travers le multivers", setup: T.check, tasks: [
      { msg: "<b>ÉCHEC !</b> La dame noire de <b>L+1</b> menace ton roi sur L0 (flèche rouge) : elle est sur un autre plateau, mais elle l'atteint ! Capture-la avec ta <b>tour</b> : elle saute de L0 vers L+1.", hint: { sel: { l: 0, t: 0, x: 4, y: 1 }, target: { l: 1, t: 0, x: 4, y: 1 } }, expect: { from: { l: 0, t: 0, x: 4, y: 1 }, to: { l: 1, t: 0, x: 4, y: 1 } } },
      { msg: "La menace a disparu ! On ne peut <b>pas valider</b> un tour qui laisse ton roi en prise. Plus qu'à le <b>valider</b>.", expect: "submit", reply: null }] },
    { title: "À toi de jouer !", setup: null, final: true, tasks: [
      { msg: "Tu connais l'essentiel : <b>multivers</b>, <b>sauts</b>, <b>voyages dans le temps</b>, <b>présent</b>, <b>échecs</b>. Gagne en faisant <b>échec et mat</b> (ou, en mode rapide, en capturant le roi). Bonne chance !", expect: "next" }] },
  ];

  // ------------------------------------------------------------------ la partie
  let CUR = null; (E.backHandlers = E.backHandlers || []).push(() => (CUR && CUR.alive ? CUR.onBack() : false));
  class Game {
    constructor(host, o) {
      CUR = this; this.o = o; this.host = host; this.mode = o.mode; this.level = o.level || 2; this.busy = false; this.sel = null; this.tuto = o.mode === "tuto" ? { i: 0, ti: 0, kinds: new Set() } : null; this.alive = true;
      this.human = o.human || "w"; this.S = o.S || FD.newGame(o.variant || "reduced", { win: o.win || "mate" });
      this.root = $c("div"); this.root.className = "fd-game"; host.appendChild(this.root);
      this.root.innerHTML = `<canvas class="fd-cv"></canvas>
        <div class="fd-top"><button class="fd-ib" data-a="quit" aria-label="Quitter">✕</button><div class="fd-chip" id="fd-chip"><i></i><b></b><small></small></div><button class="fd-ib" data-a="menu" aria-label="Menu">☰</button></div>
        <div class="fd-status" id="fd-status"></div>
        <div class="fd-legend" id="fd-legend" hidden><span><i class="a"></i>ici</span><span><i class="b"></i>autre plateau</span><span><i class="c"></i>prise</span><span><i class="d"></i>nouvelle timeline</span></div>
        <div class="fd-bottom"><button class="fd-btn" data-a="undo"><span>↶</span>Annuler</button><button class="fd-btn" data-a="fit"><span>🔭</span>Vue</button><button class="fd-btn fd-go" data-a="submit"><span>✓</span>Valider</button><button class="fd-btn" data-a="help"><span>?</span>Règles</button></div>
        <div class="fd-banner" id="fd-banner"></div><div class="fd-think" id="fd-think" hidden>ETO réfléchit<i>.</i><i>.</i><i>.</i></div>
        <div class="fd-tuto" id="fd-tuto" hidden></div><div class="fd-menu" id="fd-menu" hidden></div><div class="fd-over" id="fd-over" hidden></div><div class="fd-promo" id="fd-promo" hidden></div>`;
      this.q = (s) => this.root.querySelector(s);
      this.view = new E.fivedView.View(this.q(".fd-cv"), {}); this.view.setQuality(E.settings.get("fived.fx", "max") === "low"); this.view.S = this.S; this.view.human = this.human;
      this.view.onTap = (x, y) => this.tap(x, y); this.view.onLand = (ev) => this.landed(ev);
      this.root.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (b) this.act(b.dataset.a, b); });
      this.afterState(true);
      if (this.tuto) this.tutoStart(0);
      else if (this.S.turn !== this.human && this.mode === "ai" && !this.S.over) this.aiTurn();
      else this.banner(this.mode === "duo" ? "BLANCS JOUENT" : "À TOI !", "cyan", this.S.variant === "standard" ? "8×8" : "5×5", 1000);
    }
    destroy() { this.alive = false; if (CUR === this) CUR = null; this.view.destroy(); this.root.remove(); }
    onBack() {                                                                                                         // bouton Retour d'Android : ferme la fiche ouverte, sinon ouvre le menu
      const r = document.querySelector(".fd-rules"); if (r) { r.remove(); return true; }
      for (const id of ["#fd-promo", "#fd-menu"]) { const m = this.q(id); if (m && !m.hidden) { m.hidden = true; return true; } }
      const ov = this.q("#fd-over"); if (ov && !ov.hidden) { this.quit(); return true; }
      this.menu(); return true;
    }

    // ---- interface
    act(a, btn) {
      if (a === "quit") return this.quit();
      if (a === "menu") return this.menu();
      if (a === "help") return this.rules();
      if (this.busy && a !== "fit") return;
      if (a === "fit") { this.view.fitAll(); this.fitOn = !this.fitOn; if (!this.fitOn) this.view.fitPresent(); this.view.free = false; return; }
      if (a === "undo") return this.undo();
      if (a === "submit") return this.submit();
    }
    banner(text, col, sub, ms) {
      const b = this.q("#fd-banner"); b.className = "fd-banner"; void b.offsetWidth; b.style.setProperty("--c", E.fivedView.rgb(E.fivedView.COL[col || "cyan"])); b.innerHTML = `<b>${esc(text)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}`; b.classList.add("on");
      clearTimeout(this._bt); this._bt = setTimeout(() => b.classList.remove("on"), ms || 1500);
    }
    status(html) { this.q("#fd-status").innerHTML = html || ""; this.q("#fd-status").hidden = !html; }
    afterState(snap) {
      const S = this.S, v = this.view, me = this.mode === "duo" ? S.turn : this.human; v.human = me; v.mine = !this.busy && !S.over && (this.mode === "duo" || S.turn === this.human);
      const chip = this.q("#fd-chip"), p = FD.present(S); chip.className = "fd-chip " + S.turn; chip.querySelector("b").textContent = (S.turn === "w" ? "BLANCS" : "NOIRS") + " · TOUR " + S.turnNo; chip.querySelector("small").textContent = "présent T" + (Math.floor(p / 2) + 1) + " · " + Object.keys(S.tl).length + " timeline" + (Object.keys(S.tl).length > 1 ? "s" : "");
      const can = FD.canSubmit(S), my = v.mine; this.threats = [];
      if (S.rules.win !== "king" && my) { this.threats = can ? FD.threats(S, FD.other(S.turn)) : FD.checkNow(S, S.turn).map((x) => ({ piece: x.piece, from: Object.assign({}, x.from, { t: Math.min(x.from.t, FD.latest(S, x.from.l)) }), to: Object.assign({}, x.to, { t: Math.min(x.to.t, FD.latest(S, x.to.l)) }) })); }
      v.threats = this.threats; const go = this.q("[data-a=submit]"); go.disabled = !(can && my && !this.threats.length && !S.over); go.classList.toggle("ready", !go.disabled); this.q("[data-a=undo]").disabled = !(S.turnMoves.length && my && !S.over);
      let st = ""; if (S.over) st = ""; else if (!my) st = ""; else if (this.threats.length) st = can ? "⚠ Ton roi serait capturable : corrige avant de valider." : "⚠ ÉCHEC ! Sors ton roi de la menace (flèches rouges)."; else if (can) st = "Plus rien à jouer au présent : appuie sur <b>VALIDER</b>."; else { const n = FD.movable(S, S.turn).length; st = n > 1 ? `Joue sur <b>${n} plateaux</b> du présent (cadres cyan).` : "Joue sur le plateau du <b>présent</b> (cadre cyan)."; }
      this.status(this.tuto ? "" : st); v.topInset = this.tuto ? this.tutoBottom() : 74;
      if (snap) { v.assets.then(() => { v.fitPresent(true); }); v.fitPresent(true); }
      v.dirty = true;
    }
    frameNext() {
      const v = this.view, S = this.S; if (S.over) return v.fitAll();
      const mv = FD.movable(S, S.turn).map((l) => ({ l, t: FD.latest(S, l) })); const last = (S.turnMoves[S.turnMoves.length - 1] || {}).ev; const list = mv.length ? mv : last ? last.boards : [];
      if (list.length) v.frame(list, { maxZ: 1.1 }); else v.fitPresent();
    }

    // ---- toucher
    tap(px, py) {
      if (this.busy || this.S.over || !this.view.mine) { if (this.view.free) this.view.free = false; return; }
      const h = this.view.hit(px, py); if (!h) { this.deselect(); return; }
      if (h.kind === "target") return this.tryMove(h.c);
      const S = this.S, mvbl = FD.movable(S, S.turn), b = FD.boardAt(S, h.l, h.t), v = b[h.y * S.W + h.x], isMine = v && (v > 0) === (S.turn === "w");
      if (isMine && h.t === FD.latest(S, h.l) && mvbl.includes(h.l)) return this.select(h);
      if (isMine) { Sfx.play("err"); vib(20); this.banner("Plateau du passé", "ice", h.t !== FD.latest(S, h.l) ? "on ne joue que sur les plateaux récents" : "pas au présent", 1200); }
      this.deselect();
    }
    select(h) {
      const S = this.S, v = this.view; if (this.tuto && !this.tutoAllowSelect(h)) return;
      const tg = FD.targets(S, h.l, h.t, h.x, h.y); this.sel = h; v.sel = h; v.targets = tg; Sfx.play("select"); vib(8);
      this.q("#fd-legend").hidden = !tg.length; if (!tg.length) this.banner("Aucun coup", "ice", "cette pièce est bloquée", 1100);
      const need = tg.filter((c) => !this.onScreen(c)); if (need.length) v.frame([{ l: h.l, t: h.t }].concat(tg.map((c) => ({ l: c.l, t: c.t }))), { maxZ: 0.95, pad: 60 });
      if (this.tuto) this.tutoSelected(h);
    }
    onScreen(c) { const p = this.view.pos(c.l, c.t), s = this.view.w2s(p.x, p.y); return s.x > 20 && s.x < this.view.W - 20 && s.y > 60 && s.y < this.view.H - 120; }
    deselect() { this.sel = null; this.view.sel = null; this.view.targets = []; this.q("#fd-legend").hidden = true; if (this.tuto) this.tutoHint(); }

    tryMove(c) {
      const h = this.sel; if (!h) return; if (this.tuto && !this.tutoAllowMove(h, c)) { Sfx.play("err"); vib(30); this.banner("Pas celui-là", "amber", "suis la case qui brille", 1200); return; }
      if (c.promo) return this.askPromo((k) => this.doMove(h, c, k)); this.doMove(h, c, 5);
    }
    askPromo(cb) {
      const p = this.q("#fd-promo"); p.hidden = false; p.innerHTML = `<div><b>Promotion</b><div class="row">${[5, 4, 3, 2].map((k) => `<button data-k="${k}"><img src="img/chess/${this.S.turn}${"pnbrqk"[k - 1]}.png" alt=""><span>${SYMN[k]}</span></button>`).join("")}</div></div>`;
      p.onclick = (e) => { const b = e.target.closest("[data-k]"); if (!b) return; p.hidden = true; cb(+b.dataset.k); };
    }
    doMove(h, c, promo) {
      const r = FD.play(this.S, { l: h.l, t: h.t, x: h.x, y: h.y, to: c }, promo); if (!r.ok) { this.banner(r.err, "red"); return; }
      this.sel = null; this.view.sel = null; this.view.targets = []; this.q("#fd-legend").hidden = true; this.busy = true; this.afterState(); this.view.hint = null;
      this.sound(r.ev); this.view.playMove(r.ev, () => this.moveDone(r.ev));
    }
    sound(ev) { Sfx.play(ev.branch != null ? "branch" : ev.time ? "warp" : ev.jump ? "jump" : ev.cap ? "capture" : "move"); if (ev.cap && (ev.time || ev.jump)) setTimeout(() => Sfx.play("capture"), 380); vib(ev.branch != null ? [20, 40, 30, 40, 60] : ev.time ? [20, 30, 20] : ev.cap ? 35 : 12); }
    landed(ev) {
      if (ev.branch != null) { const nl = ev.branch; this.banner("NOUVELLE TIMELINE", "magenta", lname(nl) + " · l'univers se divise", 1900); }
      else if (ev.time) this.banner("VOYAGE DANS LE TEMPS", "violet", "T" + (Math.floor(ev.from.t / 2) + 1) + " → T" + (Math.floor(ev.to.t / 2) + 1), 1500);
      else if (ev.cap) this.banner(SYMN[ev.cap].toUpperCase() + " CAPTURÉ", "amber", "", 900);
      if (ev.promo) this.banner("PROMOTION", "gold", SYMN[ev.promo], 1200);
    }
    moveDone(ev) {
      if (!this.alive) return; this.busy = false; const S = this.S; this.afterState();
      if (S.over) return this.finish();
      if (this.threats.length && FD.canSubmit(S)) { this.banner("ÉCHEC", "red", "ce tour te laisse en prise", 1200); Sfx.play("check"); }
      this.frameNext(); if (this.tuto) this.tutoProgress("move", ev);
    }
    undo() { if (!FD.undo(this.S)) return; this.view.anims = []; this.view.hide = {}; this.view.appear = {}; this.view.beams = []; this.sel = null; this.view.sel = null; this.view.targets = []; Sfx.play("select"); this.afterState(); this.frameNext(); if (this.tuto) this.tutoProgress("undo"); }
    submit() {
      const S = this.S, who = S.turn, r = FD.submit(S); if (!r.ok) { Sfx.play("err"); vib(40); this.banner(r.err, "red"); if (r.threats) this.view.threats = r.threats; return; }
      Sfx.play("submit"); vib(15); this.view.hint = null;
      if (this.tuto) { this.afterState(); return this.tutoProgress("submit"); }
      this.afterState();
      if (S.over) return this.finish();
      const nxt = S.turn; if (r.check) { this.banner("ÉCHEC !", "red", (nxt === "w" ? "les Blancs" : "les Noirs") + " sont en danger", 1500); Sfx.play("check"); vib([30, 40, 30]); }
      this.view.fitPresent(); this.save();
      if (this.mode === "ai" && S.turn !== this.human) this.aiTurn(); else if (this.mode === "duo") this.banner(S.turn === "w" ? "BLANCS JOUENT" : "NOIRS JOUENT", S.turn === "w" ? "gold" : "violet", "passe le téléphone", 1400);
    }

    // ---- ETO
    aiTurn() {
      if (!this.alive || this.S.over) return; this.busy = true; this.afterState(); this.q("#fd-think").hidden = false;
      setTimeout(() => {
        if (!this.alive) return; let seq = null; try { seq = FD.aiTurn(this.S, { level: this.level }); } catch (e) { seq = null; }
        this.q("#fd-think").hidden = true;
        if (!seq || !seq.length) { this.busy = false; this.banner("ETO ne peut plus jouer", "ice", "", 1200); if (this.S.turnMoves.length === 0) { this.S.over = { winner: this.human, why: "ETO n'a plus de coup", kind: "stalemate" }; this.finish(); } return; }
        this.playSeq(seq, 0);
      }, 450);
    }
    playSeq(seq, i) {
      if (!this.alive) return; const S = this.S;
      if (i >= seq.length || S.over) {
        if (!S.over) { const r = FD.submit(S); if (!r.ok) { this.banner("ETO : tour refusé", "red", r.err, 1500); this.busy = false; this.afterState(); return; } this.afterState(); this.busy = false; this.afterState(); if (S.over) return this.finish(); if (r.check) { this.banner("ÉCHEC !", "red", "ton roi est menacé", 1600); Sfx.play("check"); vib([40, 50, 40]); } this.view.fitPresent(); this.save(); if (!this.threats.length && !r.check) this.banner("À TOI", "cyan", "", 700); return; }
        this.busy = false; this.afterState(); return this.finish();
      }
      const m = seq[i], r = FD.play(S, m, m.promo || 5); if (!r.ok) { this.busy = false; this.afterState(); return; }
      this.view.mine = false; this.sound(r.ev); this.view.playMove(r.ev, () => { this.view.hide = {}; setTimeout(() => this.playSeq(seq, i + 1), 220); });
    }

    // ---- fin
    finish() {
      const S = this.S, o = S.over, el = this.q("#fd-over"); this.busy = true; this.view.mine = false; this.view.fitAll(); try { E.settings.set(SAVE, ""); } catch (e) { /* rien */ }
      const won = o.winner === null ? 0 : (this.mode === "duo" || o.winner === this.human) ? 1 : -1; Sfx.play(won > 0 ? "win" : won < 0 ? "lose" : "submit"); vib(won ? [40, 60, 40, 60, 120] : 40);
      const kingPos = o.winner ? null : null; void kingPos; this.view.doFlash(won < 0 ? E.fivedView.COL.red : E.fivedView.COL.gold, 0.5); this.view.doShake(12);
      for (let i = 0; i < 8; i++) setTimeout(() => { const b = this.view.allBoards().filter((q) => q.t === FD.latest(S, q.l)); const q = b[Math.floor(Math.random() * b.length)]; if (q) { const p = this.view.pos(q.l, q.t); this.view.burst(p.x, p.y, E.fivedView.COL[i % 2 ? "gold" : "cyan"], 40, 230, 4.5, 1.4); this.view.ring(p.x, p.y, E.fivedView.COL.gold, 260, 1.1, 6); } }, 200 + i * 260);
      setTimeout(() => {
        el.hidden = false; const who = o.winner === "w" ? "Blancs" : o.winner === "b" ? "Noirs" : "";
        el.innerHTML = `<div class="fd-card ${won > 0 ? "win" : won < 0 ? "lose" : ""}"><h2>${o.winner ? (this.mode === "duo" ? `Victoire des ${who}` : won > 0 ? "VICTOIRE" : "DÉFAITE") : "NULLE"}</h2><p>${esc(o.why)}${o.winner && this.mode !== "duo" ? "" : ""}</p><p class="m">${S.turnNo} tour${S.turnNo > 1 ? "s" : ""} · ${Object.keys(S.tl).length} timeline${Object.keys(S.tl).length > 1 ? "s" : ""}</p><div class="row"><button class="fd-b pri" data-o="again">REJOUER</button><button class="fd-b" data-o="look">REVOIR</button><button class="fd-b" data-o="quit">MENU</button></div></div>`;
        el.onclick = (e) => { const b = e.target.closest("[data-o]"); if (!b) return; if (b.dataset.o === "quit") this.quit(); else if (b.dataset.o === "again") { this.quit(true); } else { el.hidden = true; this.busy = false; this.view.free = false; } };
      }, 1700);
    }
    save() { try { if (this.mode !== "tuto" && !this.S.over) E.settings.set(SAVE, JSON.stringify({ g: FD.serialize(this.S), mode: this.mode, level: this.level, human: this.human })); } catch (e) { /* rien */ } }
    quit(again) { const cb = this.o.onQuit; this.destroy(); if (cb) cb(again); }
    menu() {
      const m = this.q("#fd-menu"); m.hidden = false; const snd = Sfx.on(), hap = E.settings.get("fived.haptic", true) !== false;
      m.innerHTML = `<div class="fd-card"><h3>Menu</h3><div class="row col"><button class="fd-b" data-m="resume">REPRENDRE</button><button class="fd-b" data-m="sound">Son : ${snd ? "activé" : "coupé"}</button><button class="fd-b" data-m="haptic">Vibrations : ${hap ? "activées" : "coupées"}</button>${this.tuto ? "" : `<button class="fd-b" data-m="resign">ABANDONNER</button>`}<button class="fd-b" data-m="quit">QUITTER</button></div></div>`;
      m.onclick = (e) => { const b = e.target.closest("[data-m]"); if (!b) { if (e.target === m) m.hidden = true; return; } const a = b.dataset.m; if (a === "resume") m.hidden = true; else if (a === "sound") { E.settings.set("fived.sound", !snd); this.menu(); } else if (a === "haptic") { E.settings.set("fived.haptic", !hap); this.menu(); } else if (a === "quit") { m.hidden = true; this.save(); this.quit(); } else if (a === "resign") { m.hidden = true; this.S.over = { winner: this.mode === "duo" ? FD.other(this.S.turn) : FD.other(this.human), why: "Abandon", kind: "resign" }; this.finish(); } };
    }
    rules() { showRules(this.root, () => {}); }

    // ================= TUTORIEL =================
    tutoStart(i) {
      const st = STEPS[i], t = this.tuto; t.i = i; t.ti = 0; t.kinds = new Set(); this.q("#fd-tuto").hidden = false; this.q(".fd-bottom").classList.add("tut");
      if (st.setup) { this.S = st.setup(); this.view.S = this.S; this.view.anims = []; this.view.parts = []; this.view.hide = {}; this.view.appear = {}; this.view.beams = []; this.sel = null; this.view.sel = null; this.view.targets = []; this.view.fitPresent(true); this.view.free = false; }
      this.busy = false; this.human = "w"; this.afterState(); this.tutoAdvance(); this.tutoDraw(); this.banner(st.title.toUpperCase(), "cyan", "étape " + (i + 1) + " / " + STEPS.length, 1400);
    }
    tutoBottom() { const el = this.q("#fd-tuto"); if (!el || el.hidden) return 74; return Math.round(el.getBoundingClientRect().bottom - this.root.getBoundingClientRect().top + 14); }
    task() { const t = this.tuto; return STEPS[t.i].tasks[t.ti]; }
    tutoAdvance() {                                                                                                   // saute les tâches déjà accomplies
      const t = this.tuto; let task = this.task();
      while (task && task.done && task.done(this.S) && t.ti < STEPS[t.i].tasks.length - 1) { t.ti++; task = this.task(); }
      if (task && task.overview) { this.view.fitAll(); }
      this.tutoHint();
    }
    tutoHint() {
      const task = this.task(), v = this.view; if (!task || !task.hint) { v.hint = null; return; }
      const h = task.hint; v.hint = this.sel && h.target ? h.target : h.sel || h.target || null;
    }
    tutoAllowSelect(h) { const task = this.task(); if (!task) return true; if (task.expect && task.expect.from) { const f = task.expect.from; return f.l === h.l && f.t === h.t && f.x === h.x && f.y === h.y; } if (task.kinds) return true; if (task.hint && task.hint.sel && !task.hint.target) { const f = task.hint.sel; return f.l === h.l || true; } return true; }
    tutoAllowMove(h, c) { const task = this.task(); if (task && task.kinds) return false; if (!task || !task.expect || !task.expect.to) return true; const e = task.expect; return e.from.l === h.l && e.from.t === h.t && e.from.x === h.x && e.from.y === h.y && e.to.l === c.l && e.to.t === c.t && e.to.x === c.x && e.to.y === c.y; }
    tutoSelected(h) {
      const task = this.task(); this.tutoHint(); if (!task || !task.kinds) return; const v = this.S.tl[h.l].list[h.t - this.S.tl[h.l].t0][h.y * this.S.W + h.x], k = "pnbrqk"[Math.abs(v) - 1];
      this.tuto.kinds.add(k); const info = { q: "<b>Dame</b> : tout ! Tour + fou + « licornes » : 1 à 4 axes à la fois.", r: "<b>Tour</b> : 1 axe à la fois (colonne, rangée, <b>temps</b> ou <b>timeline</b>).", b: "<b>Fou</b> : 2 axes à pas égaux (ex. colonne + temps).", n: "<b>Cavalier</b> : saute 2 pas sur un axe et 1 sur un autre.", p: "<b>Pion</b> : avance d'1 vers l'avant, en rangée <u>ou en timeline</u> ; prend en diagonale.", k: "<b>Roi</b> : 1 pas dans toutes les directions." }[k];
      this.tuto.info = info; this.tutoDraw(); if (["q", "r", "b", "n", "p"].every((x) => this.tuto.kinds.has(x))) this.tutoDone();
    }
    tutoProgress(kind, ev) {
      const t = this.tuto, task = this.task(); if (!task) return;
      if (task.expect === "submit" && kind === "submit") { return this.tutoReply(task); }
      if (task.expect && task.expect.from && kind === "move") { this.tutoDone(); return; }
      if (task.done && task.done(this.S)) { this.tutoDone(); return; }
      if (kind === "undo") this.tutoAdvance();
    }
    tutoReply(task) {
      if (!task.reply) return this.tutoDone();
      this.busy = true; const seq = task.reply.slice(); const run = (i) => {
        if (!this.alive) return; if (i >= seq.length) { const r = FD.submit(this.S); this.busy = false; this.afterState(); this.view.fitPresent(); return this.tutoDone(); }
        const m = seq[i], r = FD.play(this.S, m, 5); if (!r.ok) { this.busy = false; return this.tutoDone(); } this.sound(r.ev); this.view.playMove(r.ev, () => { this.view.hide = {}; setTimeout(() => run(i + 1), 250); });
      };
      setTimeout(() => run(0), 450);
    }
    tutoDone() { const t = this.tuto, st = STEPS[t.i]; Sfx.play("win"); vib(25); this.view.hint = null; if (t.ti < st.tasks.length - 1) { t.ti++; this.tutoAdvance(); this.tutoDraw(); this.banner("BIEN JOUÉ", "green", "", 700); } else { t.finished = true; this.tutoDraw(); this.banner("ÉTAPE RÉUSSIE", "green", "", 1000); } }
    tutoDraw() {
      const t = this.tuto, st = STEPS[t.i], task = this.task(), el = this.q("#fd-tuto"), last = t.i === STEPS.length - 1, ready = t.finished || (task && task.expect === "next");
      el.innerHTML = `<div class="fd-tcard"><div class="fd-dots">${STEPS.map((s, i) => `<i class="${i < t.i ? "d" : i === t.i ? "c" : ""}"></i>`).join("")}</div><h4>${esc(st.title)}</h4><p>${t.finished && !(task && task.expect === "next") ? "✔ Étape réussie !" : task ? task.msg : ""}</p>${t.info && task && task.kinds ? `<p class="k">${t.info}</p>` : ""}${task && task.kinds ? `<p class="k">${["q", "r", "b", "n", "p"].map((k) => `<span class="${t.kinds.has(k) ? "on" : ""}">${{ q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" }[k]}</span>`).join("")}</p>` : ""}<div class="row"><button class="fd-b" data-t="skip">${last ? "" : "Passer le tuto"}</button><button class="fd-b ${ready ? "pri pulse" : ""}" data-t="next" ${ready ? "" : "disabled"}>${last ? "JOUER !" : "SUIVANT ▸"}</button></div></div>`;
      el.onclick = (e) => { const b = e.target.closest("[data-t]"); if (!b) return; if (b.dataset.t === "skip") this.quit(); else if (!b.disabled) this.tutoNext(); };
      this.view.topInset = this.tutoBottom();
    }
    tutoNext() {
      const t = this.tuto, st = STEPS[t.i]; Sfx.play("select");
      if (!t.finished && st.tasks[t.ti].expect === "next" && t.ti < st.tasks.length - 1) { t.ti++; this.tutoAdvance(); this.tutoDraw(); return; }
      if (t.i >= STEPS.length - 1) { try { E.settings.set("fived.tutodone", true); } catch (e) { /* rien */ } return this.quit("play"); }
      t.finished = false; this.tutoStart(t.i + 1);
    }
  }

  // ------------------------------------------------------------------ règles (fiche)
  function showRules(host, close) {
    const o = $c("div"); o.className = "fd-rules"; host.appendChild(o);
    const pages = [
      ["Le multivers", "Chaque <b>timeline</b> est une partie. Les <b>lignes</b> sont les timelines (L0 est l'originale), les <b>colonnes</b> le temps. Un coup ajoute un plateau à droite."],
      ["Le présent", "La barre <b>PRÉSENT</b> est le plus ancien dernier plateau. Tu dois jouer sur <b>tous les plateaux du présent</b> (cadre cyan), puis <b>VALIDER</b>."],
      ["Sauter, voyager", "Une pièce peut changer de <b>plateau</b> : les deux avancent. Si le plateau visé est <b>dans le passé</b>, une <b>nouvelle timeline</b> naît de ce moment. Le présent peut alors <b>reculer</b>."],
      ["Les pièces", "<b>Tour</b> : 1 axe · <b>Fou</b> : 2 axes · <b>Dame</b> : 1 à 4 axes · <b>Cavalier</b> : 2+1 pas sur deux axes · <b>Roi</b> : 1 pas partout · <b>Pion</b> : 1 pas en rangée ou en timeline, prend en diagonale. Axes : colonne, rangée, temps, timeline."],
      ["Échec et mat", "Tu ne peux pas valider un tour qui laisse un <b>roi capturable</b> sur n'importe quel plateau, même dans une autre timeline. Pas de mat possible = <b>pat</b>. Mode rapide : capturer un roi gagne."],
      ["Limites", "Tu ne peux créer une timeline que si tu en as créé <b>autant ou moins</b> que ton adversaire. Les timelines trop avancées deviennent <b>inactives</b> (grisées). Pas de roque, pas de prise en passant, pas de double pas."],
    ];
    let i = 0; const draw = () => { o.innerHTML = `<div class="fd-card"><div class="fd-dots">${pages.map((p, k) => `<i class="${k === i ? "c" : k < i ? "d" : ""}"></i>`).join("")}</div><h3>${pages[i][0]}</h3><p>${pages[i][1]}</p><div class="row"><button class="fd-b" data-r="prev" ${i ? "" : "disabled"}>◂</button><button class="fd-b pri" data-r="next">${i === pages.length - 1 ? "OK" : "▸"}</button></div></div>`; };
    o.onclick = (e) => { const b = e.target.closest("[data-r]"); if (!b) { if (e.target === o) { o.remove(); close(); } return; } if (b.dataset.r === "prev") i = Math.max(0, i - 1); else if (i === pages.length - 1) { o.remove(); close(); return; } else i++; draw(); };
    draw();
  }

  // ------------------------------------------------------------------ module
  E.suite.register({
    id: "fived", group: "chess", title: "5D Chess", sub: "Multivers · voyage dans le temps",
    icon: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M11 7h4a3 3 0 0 1 3 3v3M14.5 11.5L18 14l3.5-2.5"/>',
    onShow() { if (this._hero && this._hero.view) { this._hero.view.dirty = true; } if (this._refreshResume) this._refreshResume(); },
    build(el, A) {
      const prefs = Object.assign({ variant: "reduced", win: "mate", level: 2, side: "w", fx: "max" }, E.settings.get(PREF, {}) || {}), $ = (s) => el.querySelector(s);
      const saved = () => { try { const s = E.settings.get(SAVE, ""); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
      el.innerHTML = `<div class="fd-home">
          <div class="fd-hero"><canvas id="fd-hero"></canvas><div class="fd-title"><small>MULTIVERS · VOYAGE DANS LE TEMPS</small><b>5D CHESS</b><span>${E.fivedView.wideGamut ? "couleurs P3 / HDR actives" : "rendu néon"}</span></div></div>
          <div class="fd-menu-b">
            <button class="fd-b big pri" id="fd-play">JOUER CONTRE ETO</button>
            <div class="row"><button class="fd-b" id="fd-duo">À DEUX</button><button class="fd-b ${E.settings.get("fived.tutodone", false) ? "" : "pulse"}" id="fd-tuto">TUTORIEL</button><button class="fd-b" id="fd-rules">RÈGLES</button></div>
            <button class="fd-b" id="fd-resume" hidden>REPRENDRE LA PARTIE</button>
          </div>
          <div class="card fd-opts"><h3>Partie</h3>
            <div class="fd-row"><span>Plateau</span><div class="seg" data-k="variant"><button data-v="reduced">5×5</button><button data-v="standard">8×8</button></div></div>
            <div class="fd-row"><span>Victoire</span><div class="seg" data-k="win"><button data-v="mate">Échec et mat</button><button data-v="king">Roi capturable</button></div></div>
            <div class="fd-row"><span>Niveau d'ETO</span><div class="seg" data-k="level"><button data-v="1">1</button><button data-v="2">2</button><button data-v="3">3</button></div></div>
            <div class="fd-row"><span>Tu joues</span><div class="seg" data-k="side"><button data-v="w">Blancs</button><button data-v="b">Noirs</button><button data-v="r">Au hasard</button></div></div>
            <div class="fd-row"><span>Effets</span><div class="seg" data-k="fx"><button data-v="max">Maximum</button><button data-v="low">Réduits</button></div></div>
            <p class="muted">Règles simplifiées : sans roque, prise en passant ni double pas.</p></div></div>`;
      const paint = () => el.querySelectorAll(".seg[data-k]").forEach((s) => s.querySelectorAll("button").forEach((b) => b.classList.toggle("on", String(prefs[s.dataset.k]) === b.dataset.v)));
      el.querySelectorAll(".seg[data-k]").forEach((s) => (s.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; prefs[s.dataset.k] = s.dataset.k === "level" ? +b.dataset.v : b.dataset.v; E.settings.set(PREF, prefs); E.settings.set("fived.fx", prefs.fx); paint(); }));
      paint(); this._el = el;
      // héros : une partie ETO contre ETO qui tourne en boucle
      const cv = $("#fd-hero"); let hero = null, demoTimer = 0, demoS = null;
      const startHero = () => {
        if (hero) return; hero = this._hero = { view: new E.fivedView.View(cv, { demo: true }) }; hero.view.demo = true; hero.view.setQuality(prefs.fx === "low"); hero.view.mine = false;
        const reset = () => { if (!hero) return; demoS = FD.newGame("reduced", { win: "king" }); hero.view.S = demoS; hero.view.anims = []; hero.view.appear = {}; hero.view.hide = {}; hero.view.beams = []; hero.view.fitPresent(true); };
        const hv = hero.view; reset(); const step = () => {
          if (!hv.alive || !el.isConnected) return; if (document.hidden || el.closest("[hidden]")) { demoTimer = setTimeout(step, 1200); return; }
          if (demoS.over || demoS.turnNo > 14) { reset(); demoTimer = setTimeout(step, 900); return; }
          let seq = null; try { seq = FD.aiTurn(demoS, { level: 1, ms: 80 }); } catch (e) { /* rien */ }
          if (!seq) { reset(); demoTimer = setTimeout(step, 900); return; }
          const run = (i) => { if (!hv.alive) return; if (i >= seq.length || demoS.over) { FD.submit(demoS); hv.frame(hv.allBoards().filter((q) => q.t >= FD.present(demoS) - 3), { maxZ: 0.95, top: 20, bottom: 70, pad: 40 }); demoTimer = setTimeout(step, 700); return; } const r = FD.play(demoS, seq[i], 5); if (!r.ok) { demoTimer = setTimeout(step, 400); return; } hv.playMove(r.ev, () => { hv.hide = {}; setTimeout(() => run(i + 1), 200); }); };
          run(0);
        };
        demoTimer = setTimeout(step, 700);
      };
      const stopHero = () => { clearTimeout(demoTimer); if (hero) { hero.view.destroy(); hero = this._hero = null; } };
      this._startHero = startHero; this._stopHero = stopHero; setTimeout(startHero, 60);
      const launch = (o) => {
        if (this._game && this._game.alive) this._game.destroy();
        stopHero(); let human = prefs.side === "r" ? (Math.random() < 0.5 ? "w" : "b") : prefs.side;
        const g = new Game(document.getElementById("app") || document.body, Object.assign({ variant: prefs.variant, win: prefs.win, level: prefs.level, human, mode: "ai", onQuit: (again) => { this._game = null; if (again === "play") { launch({ mode: "ai" }); return; } if (again === true) { launch(o); return; } setTimeout(startHero, 100); refreshResume(); } }, o));
        this._game = g;
      };
      $("#fd-play").onclick = () => launch({ mode: "ai" });
      $("#fd-duo").onclick = () => launch({ mode: "duo", human: "w" });
      $("#fd-tuto").onclick = () => launch({ mode: "tuto" });
      $("#fd-rules").onclick = () => showRules(el.closest(".subview") || document.body, () => {});
      const rb = $("#fd-resume"), refreshResume = () => {
        const s = saved(); rb.hidden = !s; rb.onclick = () => { const q = saved(); if (!q) return; try { launch({ mode: q.mode, level: q.level, human: q.human, S: FD.deserialize(q.g) }); } catch (e) { A.toast("Sauvegarde illisible.", "err"); E.settings.set(SAVE, ""); rb.hidden = true; } };
      }; this._refreshResume = refreshResume; refreshResume();
      el._api = { launch, FD, Game, STEPS, game: () => this._game, prefs };
    },
  });
})();
