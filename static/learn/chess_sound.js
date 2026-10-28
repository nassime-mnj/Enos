"use strict";
// EFFETS SONORES DES ÉCHECS (Web Audio) : déplacement, échec, promotion, mat = vrais sons Chess.com embarqués (chess_sounds_data.js, mp3 en base64) ;
// prise = synthétisée (claquement grave + souffle). Le contexte audio démarre au premier geste de l'utilisateur (règle d'Android).
(() => {
  const E = window.ENOS;
  const S = (E.chessSound = {});
  let ctx = null;
  const bufs = {};

  const ac = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  const load = (k) => (bufs[k] ??= ac().decodeAudioData(bytes((window.ENOS_CHESS_SND || {})[k] || "")).catch(() => null));

  function capture(a) {
    const t = a.currentTime, g = a.createGain();
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16); g.connect(a.destination);
    const o = a.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.12); o.connect(g); o.start(t); o.stop(t + 0.17);
    const n = a.createBuffer(1, Math.floor(a.sampleRate * 0.06), a.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = a.createBufferSource(), f = a.createBiquadFilter(), ng = a.createGain();
    f.type = "bandpass"; f.frequency.value = 1800; ng.gain.value = 0.5; src.buffer = n; src.connect(f); f.connect(ng); ng.connect(a.destination); src.start(t);
  }

  /** kind : move | capture | check | promote | mate | brilliant */
  S.play = async (kind) => {
    if (!E.settings.get("chess.sound", true)) return;
    try {
      const a = ac();
      if (a.state === "suspended") await a.resume();
      if (kind === "capture") return capture(a);
      const b = await load(kind === "check" || kind === "promote" || kind === "mate" || kind === "brilliant" ? kind : "move");
      if (!b) return;
      const s = a.createBufferSource(); s.buffer = b; s.connect(a.destination); s.start();
    } catch (e) { /* audio indisponible : le jeu continue en silence */ }
  };

  /** Son d'un coup d'après sa notation SAN (# mat, + échec, = promotion, x prise). */
  S.forSan = (san) => S.play(/#/.test(san) ? "mate" : /\+/.test(san) ? "check" : /=/.test(san) ? "promote" : /x/.test(san) ? "capture" : "move");

  /** Son d'un coup : `before` = carte des pièces avant, `uci` le coup, `r` = {check, over} de la position obtenue. */
  S.forMove = (before, uci, r) => {
    const from = uci.slice(0, 2), to = uci.slice(2, 4), p = before[from] || "";
    const cap = !!before[to] || (p.toLowerCase() === "p" && from[0] !== to[0]);
    S.play(r && /mat/i.test(r.over || "") ? "mate" : r && r.check ? "check" : uci[4] ? "promote" : cap ? "capture" : "move");
  };
})();
