"use strict";
// CHESS EDIT STUDIO — SOUND DESIGN (mobile, Web Audio). Tous les sons sont PROGRAMMÉS sur l'horloge audio à la frame près (pas de setTimeout) :
//   · bruits d'échecs (déplacement, prise, échec, promotion, mat, brillant) calés sur l'impact de chaque coup ;
//   · voix de Levy (audio/levy/*.mp3 : the_queen, the_rook, the_bishop, the_knight, this_is_the_way) sur les coups clés, avec le traitement « slowed + reverb » :
//     légèrement ralenties (plus graves), passe-haut, puis REVERB à convolution (réponse impulsionnelle synthétique de 2,6 s) + ÉCHO (délai 310 ms à retours) pour un rendu dramatique.
// Le même réglage existe côté PC (nasko_chessedit.py : afir + aecho de FFmpeg) pour le rendu vidéo.
(() => {
  const E = window.ENOS;
  const VOICES = ["the_queen", "the_rook", "the_bishop", "the_knight", "this_is_the_way"];
  const FX = { slowed: 0.93, highpass: 170, dry: 0.85, wet: 1.3, echo: 0.2, echoTime: 0.42, echoFeedback: 0.16, lowpass: 3600, irSeconds: 3.4, irDecay: 2.6 };         // reverb PUISSANTE (plus fort que le sec), écho discret : une seule répétition audible

  /** réponse impulsionnelle stéréo synthétique : bruit qui s'éteint, de plus en plus sourd (réverbération de grande salle) */
  function impulse(ctx, seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c); let lp = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len, coef = 0.85 - 0.7 * k, x = (Math.random() * 2 - 1) * Math.pow(1 - k, decay);
        lp += (x - lp) * Math.max(0.12, coef); d[i] = lp * 1.9 + (i < ctx.sampleRate * 0.012 && Math.random() < 0.05 ? (Math.random() * 2 - 1) * 0.6 : 0);   // réflexions précoces
      }
    }
    return ir;
  }
  function captureBuffer(ctx) {                                                         // même claquement que chess_sound.js (triangle grave + souffle), en AudioBuffer pour pouvoir le programmer
    const sr = ctx.sampleRate, len = Math.floor(sr * 0.2), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr, f = 190 * Math.pow(70 / 190, Math.min(1, t / 0.12)); ph += (2 * Math.PI * f) / sr;
      const tri = (2 / Math.PI) * Math.asin(Math.sin(ph)), env = Math.exp(-t * 26), noise = t < 0.06 ? (Math.random() * 2 - 1) * (1 - t / 0.06) * 0.5 : 0;
      d[i] = tri * env * 0.9 + noise;
    }
    return b;
  }

  function chimeBuffer(ctx) {                                                           // cloche brillante (le mp3 « brilliant » n'est pas embarqué) : deux sinus 880 / 1320 Hz qui s'éteignent
    const sr = ctx.sampleRate, len = Math.floor(sr * 0.7), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) { const t = i / sr; d[i] = (Math.sin(2 * Math.PI * 880 * t) * 0.5 + Math.sin(2 * Math.PI * 1320 * t) * 0.35) * Math.exp(-t * 5.5) * 0.8; }
    return b;
  }

  function boomBuffer(ctx) {                                                            // impact grave de la fiche de stats : sinus 55 → 28 Hz + souffle
    const sr = ctx.sampleRate, len = Math.floor(sr * 0.7), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0); let ph = 0;
    for (let i = 0; i < len; i++) { const t = i / sr, f = 28 + 60 * Math.exp(-t * 14); ph += (2 * Math.PI * f) / sr; d[i] = (Math.sin(ph) * Math.exp(-t * 5.5) * 1.1 + (t < 0.08 ? (Math.random() * 2 - 1) * (1 - t / 0.08) * 0.6 : 0)) * 0.9; }
    return b;
  }
  function whooshBuffer(ctx) {                                                          // « whoosh » de sortie : bruit filtré qui monte
    const sr = ctx.sampleRate, len = Math.floor(sr * 0.45), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0); let lp = 0;
    for (let i = 0; i < len; i++) { const t = i / len, k = 0.04 + t * 0.5; lp += ((Math.random() * 2 - 1) - lp) * k; d[i] = lp * Math.sin(Math.PI * t) * 1.6; }
    return b;
  }

  class Player {
    constructor(ctx) {
      const S = E.chessSound; this.ctx = ctx || (S && S.ac ? S.ac() : new (window.AudioContext || window.webkitAudioContext)());
      const a = this.ctx; this.bufs = {}; this.ons = {}; this.queue = []; this.i = 0; this.t0 = 0;
      this.master = a.createGain(); this.master.gain.value = 0.95; this.master.connect(a.destination);
      this.sfx = a.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
      // voix : passe-haut -> (sec) + (reverb à convolution) + (écho à retours filtré)
      this.vin = a.createGain(); const hp = a.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = FX.highpass; this.vin.connect(hp);
      const dry = a.createGain(); dry.gain.value = FX.dry; hp.connect(dry); dry.connect(this.master);
      const conv = a.createConvolver(); conv.buffer = impulse(a, FX.irSeconds, FX.irDecay); const wet = a.createGain(); wet.gain.value = FX.wet; hp.connect(conv); conv.connect(wet); wet.connect(this.master); this.conv = conv;
      const dl = a.createDelay(1); dl.delayTime.value = FX.echoTime; const fb = a.createGain(); fb.gain.value = FX.echoFeedback; const lp = a.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = FX.lowpass;
      const eg = a.createGain(); eg.gain.value = FX.echo; hp.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(lp); lp.connect(eg); eg.connect(this.master);
      // bus « épique » (enregistrement de l'Alien Gambit) : grande reverb + écho long à plusieurs répétitions
      this.ein = a.createGain(); const ed = a.createGain(); ed.gain.value = 0.9; this.ein.connect(ed); ed.connect(this.master);
      const ec = a.createConvolver(); ec.buffer = impulse(a, 4.2, 2.2); const ew = a.createGain(); ew.gain.value = 1.4; this.ein.connect(ec); ec.connect(ew); ew.connect(this.master);
      [0.36, 0.72, 1.1].forEach((tm, k) => { const d = a.createDelay(2), f = a.createBiquadFilter(), g = a.createGain(); d.delayTime.value = tm; f.type = "lowpass"; f.frequency.value = 5200; g.gain.value = [0.5, 0.35, 0.2][k]; this.ein.connect(d); d.connect(f); f.connect(g); g.connect(this.master); });
      this.onVoice = null;
    }
    async load() {
      const a = this.ctx, S = E.chessSound, base = E.assetBase || "";
      this.bufs.capture = captureBuffer(a); this.bufs.brilliant = chimeBuffer(a); this.bufs.boom = boomBuffer(a); this.bufs.whoosh = whooshBuffer(a);
      for (const k of ["move", "capture", "check", "promote", "mate", "rec", "witty"]) { try { const r = S && S.buffer ? await S.buffer(k) : null; if (r || !this.bufs[k]) this.bufs[k] = r; } catch (e) { this.bufs[k] = null; } }
      const L = window.ENOS_LEVY || {};
      await Promise.all(VOICES.map(async (id) => {
        try {
          if (L[id]) { const raw = atob(L[id]), u8 = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i); this.bufs[id] = await a.decodeAudioData(u8.buffer); }      // voix embarquées (base64)
          else { const r = await fetch(`${base}audio/levy/${id}.mp3`); this.bufs[id] = await a.decodeAudioData(await r.arrayBuffer()); }
        } catch (e) { this.bufs[id] = null; this.err = (this.err || "") + id + " "; }
      }));
      this.voicesOk = VOICES.filter((k) => this.bufs[k]).length;
      return Object.keys(this.bufs).filter((k) => this.bufs[k]).length;
    }
    /** liste triée {t, id, gain, bus} ; t0 = instant (horloge audio) correspondant à t = 0 de la vidéo */
    arm(list, t0) { this.queue = list.slice().sort((x, y) => x.t - y.t); this.i = 0; this.t0 = t0; }
    /** à appeler à chaque image avec le temps vidéo courant : programme les sons des 350 prochaines ms sur l'horloge audio */
    pump(vt) {
      const a = this.ctx;
      while (this.i < this.queue.length && this.queue[this.i].t <= vt + 0.35) {
        const s = this.queue[this.i++], when = this.t0 + s.t;
        if (when < a.currentTime - 0.03) continue;                                        // trop tard (onglet gelé) : on saute
        this.play(s.id, Math.max(when, a.currentTime), s.gain, s.bus, s.wet);
      }
    }
    /** délai avant le premier vrai son du buffer (les mp3 de coups ont 0,1 à 0,4 s de silence au début) : le départ est avancé pour que l'IMPACT tombe pile sur `when` */
    onsetOf(id) {
      const b = this.bufs[id]; if (!b) return 0;
      if (this.ons[id] == null) {
        const d = b.getChannelData(0); let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
        let k = 0; while (k < d.length && Math.abs(d[k]) < pk * 0.1) k++;
        this.ons[id] = k / b.sampleRate;
      }
      return this.ons[id];
    }
    play(id, when, gain, bus, wet) {
      const b = this.bufs[id]; if (!b) return;
      const a = this.ctx, src = a.createBufferSource(), g = a.createGain(), rate = bus === "voice" ? FX.slowed : 1; src.buffer = b; g.gain.value = gain == null ? 1 : gain;
      if (bus === "voice") {
        src.playbackRate.value = rate; src.connect(g); g.connect(this.vin);
        if (wet > 1 && this.conv) { const x = a.createGain(); x.gain.value = wet - 1; g.connect(x); x.connect(this.conv); }                  // reverb SUPPLÉMENTAIRE (The Rook : la voix la plus importante)
        if (this.onVoice) this.onVoice(when, b.duration / rate + 1.2);
      }
      else if (bus === "epic") { src.connect(g); g.connect(this.ein); if (this.onVoice) this.onVoice(when, b.duration + 2); }
      else { src.connect(g); g.connect(this.sfx); }
      const at = when - this.onsetOf(id) / rate;
      if (at >= a.currentTime) src.start(at); else src.start(a.currentTime, Math.min(b.duration - 0.001, (a.currentTime - at) * rate));
    }
    close() { try { this.master.disconnect(); } catch (e) { /* déjà fermé */ } }
  }
  E.editSfx = { Player, FX, VOICES, impulse };
})();
