"use strict";
// MULTIEDIT — RENDU HORS LIGNE (4K 60 i/s par défaut) : rien n'est affiché pendant le calcul, seule une barre de progression avance.
//   Timeline calée sur la MUSIQUE (de la première à la dernière seconde) : chaque rebond / choc / but / coupe tombe sur un temps fort (kick) du morceau.
//   Jeux 3D : la scène est reconstruite hors écran (mode « rejeu » du jeu) et recalculée image par image depuis l'enregistrement (js/games/highlights.js) :
//     rampes de vitesse entre les chocs (ralentis naturels), arrêt sur image sur fond noir au but, zoom « coup de poing », éclair, secousse.
//   Effets GPU (un seul passage plein écran) : séparation RVB, flou radial de vitesse, isolation du sujet sur noir, texte DERRIÈRE la balle,
//     étalonnage contrasté, vignette, grain, flash. Grands mots animés sur les temps (style edit), jamais de « rebond 1 / rebond 2 ».
//   Échecs : la timeline Chess Edit dessinée image par image. Néo-Cité : carte du gros loyer (monument, montant).
//   Son : musique + bruitages de Chess Edit choisis selon la situation (impacts, boum de but, NBA, cloche, « fahh »…), mixés hors ligne ;
//   vidéo WebCodecs (HEVC si possible, sinon H.264) + son AAC/Opus, muxés en MP4.
(() => {
  const E = window.ENOS;
  const R = (E.meRender = {});
  const FPS = 60;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k, out3 = (k) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
  // rendre la main SANS minuteur : une page cachée (application en arrière-plan) voit ses setTimeout ralentis à 1 par seconde, pas les messages
  const tick = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  const GNAME = { flick: "FOOT", golf: "GOLF", bowling: "BOWLING", neocite: "NÉO-CITÉ", chess: "ÉCHECS" };

  // ------------------------------------------------------------------ musique et grille des temps
  async function musicPlan(file, needSec) {
    if (file && E.editAudio) {
      const au = await E.editAudio.analyseFile(file); const D = au.fullDuration || au.duration || needSec;
      let beats = (au.kicks || []).filter((k) => k[1] >= 0.3).map((k) => k[0]), clean = []; for (const b of beats) if (!clean.length || b - clean[clean.length - 1] > 0.17) clean.push(b);
      if (clean.length < D / 1.2) { clean = []; for (let t = 0.25; t < D; t += 0.5) clean.push(t); }
      return { file, D, beats: clean, drop: au.mainDropTimestamp || au.dropTime || 0, gen: false };
    }
    const bpm = 128, b = 60 / bpm, bar = b * 4, D = Math.max(bar * 8, Math.ceil(needSec / bar) * bar), beats = []; for (let t = 0; t < D - 1e-6; t += b) beats.push(t);
    return { file: null, D, beats, drop: bar * 2, gen: true, bpm };
  }
  const nextBeat = (beats, t) => { for (const b of beats) if (b >= t - 1e-4) return b; return null; };

  // ------------------------------------------------------------------ plan de la vidéo
  const SYNC = { bounce: 1, post: 1, hit: 1, goal: 2, cup: 2, strike: 2, spare: 2, loop: 1, water: 2, shot: 1 };
  function highlightSeg(c, beats, t0, slow) {
    slow = slow || 0.75;
    const fr = c.rp.frames, last = fr[fr.length - 1].t;
    let ev = c.rp.events.filter((e) => SYNC[e.k] && (e.k !== "hit" || e.v > 0.3) && (e.k !== "bounce" || e.v > 0.12)).sort((a, b) => a.t - b.t);
    const ded = []; for (const e of ev) if (!ded.length || e.t - ded[ded.length - 1].t > 0.1 || SYNC[e.k] > 1) ded.push(e); ev = ded.slice(0, 9);
    if (!ev.length) ev = [{ k: "key", t: c.at || last * 0.6, v: 1 }];
    // la balle file : 1 temps avant le premier choc, puis un choc par temps (ou deux temps si les chocs sont espacés), au ralenti
    const lead = Math.min(1.1, ev[0].t), pts = [[nextBeat(beats, t0) || t0, ev[0].t - lead]];
    let b = nextBeat(beats, pts[0][0] + 0.3) || pts[0][0] + 0.5; pts.push([b, ev[0].t]);
    for (let i = 1; i < ev.length; i++) { const dg = ev[i].t - ev[i - 1].t; let nb = b, steps = 0;
      while (true) { const cand = nextBeat(beats, nb + 0.12); if (cand == null) { nb += 0.5; break; } nb = cand; steps++; const sp = dg / (nb - b); if (sp <= slow || steps > 5) break; }
      b = nb; pts.push([b, ev[i].t]); }
    const big = ev.some((e) => SYNC[e.k] > 1), tail = big ? 1.6 : 1.0, endG = Math.min(last, ev[ev.length - 1].t + tail);
    // arrêt sur image (fond noir) un temps après le moment clé
    let freeze = null; if (big) { const fb = nextBeat(beats, b + 0.05) || b + 0.45; freeze = [b + 0.04, fb]; pts.push([fb, ev[ev.length - 1].t + 0.04]); b = fb; }
    const endT = (nextBeat(beats, b + (endG - pts[pts.length - 1][1]) / 0.55 * 0.6) || b + 1);
    pts.push([endT, endG]);
    const syncs = ev.map((e, i) => ({ e, T: pts[i + 1][0] }));
    return { k: "replay", c, t0: pts[0][0] > t0 + 0.6 ? t0 : t0, t1: endT, pts: [[t0, pts[0][1]], ...pts.slice(1)], freeze, syncs };
  }
  const gtAt = (seg, t) => { const p = seg.pts; if (t <= p[0][0]) return p[0][1]; for (let i = 1; i < p.length; i++) if (t <= p[i][0]) { const k = (t - p[i - 1][0]) / Math.max(1e-6, p[i][0] - p[i - 1][0]); return lerp(p[i - 1][1], p[i][1], k); } return p[p.length - 1][1]; };

  R.plan = (results, mus) => {
    const segs = [], B = mus.beats, words = [];
    const firstBeat = (t) => nextBeat(B, t) || t;
    let t = 0;
    const introEnd = firstBeat(Math.min(mus.drop && mus.drop > 2 && mus.drop < 9 ? mus.drop : 2.2, mus.D * 0.15));
    segs.push({ k: "intro", t0: 0, t1: introEnd }); words.push([firstBeat(0.15), "MULTI", "A"], [firstBeat(introEnd * 0.5), "EDIT", "B"]); t = introEnd;
    const games = results.filter((r) => !r.res.skipped), pool = [];
    const KW = { goal: "BUT", strike: "STRIKE", spare: "SPARE", water: "PLOUF" };
    const addClip = (c, g, pass) => {
      const s = highlightSeg(c, B, t, pass ? (pass % 2 ? 0.5 : 0.62) : 0.75); s.g = g; s.cam = pass ? (pass % 2 ? "chase" : "orbit") : "game"; s.orb0 = (pass * 2.1 + c.seq) % 6.28; segs.push(s);
      const kw = Object.assign({ cup: c.label === "TROU EN UN !" ? "ACE" : "DANS LE TROU" }, KW), key = s.syncs.filter((x) => SYNC[x.e.k] > 1).pop();
      if (key && kw[key.e.k]) kw[key.e.k].split(" ").forEach((w, i) => words.push([key.T + i * 0.22, w, (i + pass) % 2 ? "B" : "A"]));
      t = s.t1; };
    for (const r of games) {
      const g = r.step.g, clips = (r.clips || []).slice().sort((a, b) => a.seq - b.seq).slice(0, 4), chess = r.res.chess && r.res.chess.mv && r.res.chess.mv.length >= 2;
      if (!clips.length && !chess) continue;
      const tEnd = firstBeat(t + 1.6); segs.push({ k: "title", t0: t, t1: tEnd, g, r }); words.push([t + 0.02, GNAME[g] || g.toUpperCase(), "B"]); t = tEnd;
      if (chess) { const d = Math.min(16, Math.max(6, r.res.chessDur || 12)), e = firstBeat(t + d); segs.push({ k: "chess", t0: t, t1: e, rec: r.res.chess }); pool.push({ k: "chess", rec: r.res.chess, d, g }); t = e; }
      for (const c of clips) {
        if (c.rp) { addClip(c, g, 0); pool.push({ k: "rp", c, g }); }
        else { const e = firstBeat(t + 2.4); segs.push({ k: "money", t0: t, t1: e, c, g }); words.push([t + 0.05, c.label, "A"]); pool.push({ k: "money", c, g }); t = e; }
      }
    }
    // la musique va jusqu'au bout : les moments reviennent (autres caméras, autres ralentis) tant qu'il reste du morceau, puis le final
    const end = mus.D, bestIt = pool.filter((x) => x.k === "rp").sort((a, b) => b.c.score - a.c.score)[0], best = bestIt && bestIt.c, OUT = Math.min(6, Math.max(3.5, (end - t) * 0.08));
    for (let pass = 1; pool.length && pass < 60 && end - t > OUT + 3; pass++) {
      for (const it of pool) {
        if (end - t < OUT + 3) break;
        if (it.k === "rp") addClip(it.c, it.g, pass);
        else if (it.k === "chess") { const e = firstBeat(t + Math.min(it.d, 8)); segs.push({ k: "chess", t0: t, t1: e, rec: it.rec, from: Math.max(0, it.d - 8) }); t = e; }
        else { const e = firstBeat(t + 1.8); segs.push({ k: "money", t0: t, t1: e, c: it.c, g: it.g }); words.push([t + 0.05, it.c.label, pass % 2 ? "B" : "A"]); t = e; }
      }
    }
    if (t < end - 0.3) {
      if (best) { const a = Math.max(0, best.at - 0.9), b2 = Math.min(best.dur, best.at + 1.2); segs.push({ k: "replay", c: best, g: bestIt.g, cam: "orbit", orb0: 1.2, outro: true, results: games, t0: t, t1: end, pts: [[t, a], [end, b2]], freeze: null, syncs: [] }); }
      else segs.push({ k: "outro", t0: t, t1: end, results: games });
      words.push([firstBeat(t + 0.1), "GG", "A"], [firstBeat(Math.min(end - 1.2, t + 1.8)), "E.N.O.S.", "B"]);
    }
    else { const last = segs[segs.length - 1]; last.t1 = Math.min(last.t1, end); }
    return { segs: segs.filter((s) => s.t0 < end - 1e-3).map((s) => ((s.t1 = Math.min(s.t1, end)), s)), words: words.filter((w) => w[0] < end), D: end };
  };

  // ------------------------------------------------------------------ bruitages (ids de Chess Edit : js/chess_edit_sfx.js + js/edit_sfx_data.js)
  function sfxList(plan) {
    const L = [], add = (t, id, gain, bus) => { if (t >= 0 && t < plan.D) L.push({ t, id, gain: gain == null ? 1 : gain, bus: bus || "sfx" }); };
    for (const s of plan.segs) {
      if (s.k === "title") add(s.t0, "whoosh", 0.8);
      if (s.k === "replay") for (const { e, T } of s.syncs) {
        const g = s.g;
        if (e.k === "bounce") add(T, g === "golf" ? "move" : "capture", 0.9);
        else if (e.k === "hit") add(T, "thud", 1);
        else if (e.k === "post") add(T, "crystal", 1);
        else if (e.k === "shot") add(T, "whoosh", 0.6);
        else if (e.k === "goal") { add(T, "mateboom", 1, "hit"); add(T + 0.05, "sx_nba", 0.7, "hit"); }
        else if (e.k === "cup") { add(T, s.c.label === "TROU EN UN !" ? "sx_heaven" : "brilliant", 0.9, "hit"); add(T, "boom", 0.6); }
        else if (e.k === "loop") add(T, "sx_reload", 0.8);
        else if (e.k === "water") add(T, "sx_mariodeath", 0.8, "hit");
        else if (e.k === "strike") { add(T, "sx_finish", 1, "hit"); add(T, "mateboom", 0.8); }
        else if (e.k === "spare") add(T, "sx_knockout", 0.9, "hit");
      }
      if (s.k === "money") { const k = s.c.kind; add(s.t0 + 0.05, k === "bankrupt" ? "sx_mario" : k === "rent" && s.c.amount >= 400 ? "sx_gunshot" : "fahh", 0.9, "hit"); if (k === "rent") add(s.t0 + 0.5, "fahh_slow", 0.6, "voice"); }
      if (s.k === "outro" || s.outro) add(s.t0, "sx_gong", 0.7, "hit");
    }
    return L.sort((a, b) => a.t - b.t);
  }
  /** mixage hors ligne : musique (ou beat généré) + bruitages -> AudioBuffer stéréo 48 kHz */
  async function mixAudio(mus, plan, sfx) {
    const SR = 48000, oc = new OfflineAudioContext(2, Math.ceil(plan.D * SR), SR), mg = oc.createGain(); mg.gain.value = 0.9; mg.connect(oc.destination);
    if (mus.file) { const buf = await oc.decodeAudioData(await mus.file.arrayBuffer()); const src = oc.createBufferSource(); src.buffer = buf; src.connect(mg); src.start(0); }
    else if (E.multiEdit && E.multiEdit.beat) E.multiEdit.beat(oc, mg, 0, plan.D);
    const whoosh = (t, g) => { const n = oc.createBuffer(1, SR * 0.7, SR), d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = oc.createBufferSource(), f = oc.createBiquadFilter(), gg = oc.createGain(); s.buffer = n; f.type = "bandpass"; f.Q.value = 2; f.frequency.setValueAtTime(300, Math.max(0, t - 0.35)); f.frequency.exponentialRampToValueAtTime(6000, t + 0.05);
      gg.gain.setValueAtTime(0.001, Math.max(0, t - 0.35)); gg.gain.linearRampToValueAtTime(0.55 * g, t); gg.gain.exponentialRampToValueAtTime(0.001, t + 0.3); s.connect(f); f.connect(gg); gg.connect(oc.destination); s.start(Math.max(0, t - 0.35)); };
    let player = null; if (E.editSfx) { try { player = new E.editSfx.Player(oc); await player.load(); } catch (e) { player = null; } }
    const duck = [];
    for (const s of sfx) { if (s.id === "whoosh") { whoosh(s.t, s.gain); continue; } if (player) { player.play(s.id, s.t, s.gain, s.bus); if (s.bus === "hit" || s.bus === "voice") duck.push(s.t); } }
    duck.forEach((t) => { try { mg.gain.setValueAtTime(0.9, Math.max(0, t - 0.02)); mg.gain.linearRampToValueAtTime(0.5, t); mg.gain.linearRampToValueAtTime(0.9, t + 0.5); } catch (e) { /* chevauchement */ } });
    const out = await oc.startRendering(), n = Math.floor(Math.min(1.5, plan.D * 0.1) * SR);
    for (let c = 0; c < 2; c++) { const d = out.getChannelData(c); for (let i = 0; i < n; i++) d[d.length - 1 - i] *= i / n; }
    return out;
  }

  // ------------------------------------------------------------------ effets GPU (passage plein écran)
  const VS = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
  const FS = `precision highp float; varying vec2 vUv;
    uniform sampler2D tScene, tSubj, tText; uniform float uLinScene, uHasSubj, uBehind, uRGB, uZoom, uFlash, uIso, uTime, uGrain, uVig, uSat, uCon, uFade, uRed; uniform vec2 uShake, uCenter;
    vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
    vec3 dispS(vec3 c, float lin){ if (lin > 0.5) c = pow(aces(c), vec3(1.0/2.2)); return c; }
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    vec3 sceneAt(vec2 uv){
      vec2 d = uv - uCenter; vec3 acc = vec3(0.0); float wsum = 0.0;
      for (int i = 0; i < 8; i++) { float k = float(i) / 7.0; vec2 u = uCenter + d * (1.0 - uZoom * k * 0.18);
        vec3 c; c.r = texture2D(tScene, u + d * uRGB).r; c.g = texture2D(tScene, u).g; c.b = texture2D(tScene, u - d * uRGB).b; float w = 1.0 - k * 0.6; acc += dispS(c, uLinScene) * w; wsum += w; }
      return acc / wsum; }
    void main(){
      vec2 uv = vUv + uShake;
      vec3 col = sceneAt(uv);
      vec4 sub = uHasSubj > 0.5 ? texture2D(tSubj, uv) : vec4(0.0); sub.rgb = dispS(sub.rgb, 1.0);
      // isolation : le sujet seul, sur noir, avec un halo
      vec3 iso = sub.rgb * sub.a + vec3(0.9,0.12,0.2) * 0.25 * smoothstep(0.0, 0.6, texture2D(tSubj, uv + vec2(0.004,0.0)).a + texture2D(tSubj, uv - vec2(0.004,0.0)).a) * (1.0 - sub.a);
      col = mix(col, iso, uIso);
      vec4 tx = texture2D(tText, vec2(vUv.x, vUv.y));
      col = mix(col, tx.rgb, tx.a);
      if (uBehind > 0.5) col = mix(col, uIso > 0.5 ? iso : sub.rgb, sub.a);
      // étalonnage
      float l = dot(col, vec3(0.299,0.587,0.114)); col = mix(vec3(l), col, uSat); col = (col - 0.5) * uCon + 0.5; col += vec3(0.06,-0.01,0.0) * uRed * (1.0 - l);
      float v = distance(vUv, vec2(0.5)); col *= 1.0 - uVig * smoothstep(0.35, 0.85, v);
      col += (h(vUv * 1000.0 + uTime) - 0.5) * uGrain;
      col = mix(col, vec3(1.0), uFlash); col *= uFade;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0); }`;

  // ------------------------------------------------------------------ texte (style edit : énormes mots, lueur rouge ou blanc condensé)
  function drawWords(g, W, H, words, t, beats) {
    g.clearRect(0, 0, W, H);
    let cur = null; for (const w of words) if (w[0] <= t) cur = w; if (!cur) return false;
    const age = t - cur[0], nb = nextBeat(beats, cur[0] + 0.12), life = Math.min(1.6, Math.max(0.35, (nb || cur[0] + 0.5) - cur[0]) + 0.35); if (age > life) return false;
    const k = out3(age / 0.14), fade = age > life - 0.12 ? (life - age) / 0.12 : 1, sc = 1.25 - 0.25 * k, txt = cur[1];
    g.save(); g.translate(W / 2, H * 0.46); g.scale(sc, sc); g.globalAlpha = clamp(k * fade, 0, 1); g.textAlign = "center"; g.textBaseline = "middle";
    const size = Math.min(W * 0.3, (W * 1.7) / Math.max(2.2, txt.length));
    const fit = (f) => { g.font = f; const m = g.measureText(txt).width; if (m > W * 0.86) { const z = (W * 0.86) / m; g.scale(z, z); } };
    if (cur[2] === "A") { fit(`900 ${size}px "Noto Serif", Georgia, "Times New Roman", serif`); g.shadowColor = "rgba(255,30,40,0.95)"; g.shadowBlur = size * 0.35; g.fillStyle = "#ff2333"; g.fillText(txt, 0, 0); g.shadowBlur = size * 0.12; g.fillStyle = "#ff4a55"; g.fillText(txt, 0, 0); }
    else { const sz = size * 1.35; fit(`400 ${sz}px "Bebas Neue", Oswald, Impact, sans-serif`); g.fillStyle = "rgba(255,0,60,0.55)"; g.fillText(txt, -sz * 0.02, 0); g.fillStyle = "rgba(0,220,255,0.5)"; g.fillText(txt, sz * 0.02, 0); g.shadowColor = "rgba(255,255,255,0.5)"; g.shadowBlur = sz * 0.12; g.fillStyle = "#ffffff"; g.fillText(txt, 0, 0); }
    g.restore(); return true;
  }
  // cartes 2D (titres, Néo-Cité, intro, récap) — jamais d'image de fichier (texture « salie ») : formes, texte, images embarquées
  function drawCard(g, W, H, seg, t, res) {
    const lt = t - seg.t0, d = seg.t1 - seg.t0;
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#07070b"); bg.addColorStop(1, "#140409"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const rg = g.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H * 0.45, H * 0.6); rg.addColorStop(0, `rgba(239,23,72,${0.35 + 0.15 * Math.sin(lt * 6)})`); rg.addColorStop(1, "rgba(239,23,72,0)"); g.fillStyle = rg; g.fillRect(0, 0, W, H);
    // traits de vitesse
    g.save(); g.translate(W / 2, H / 2); g.strokeStyle = "rgba(255,255,255,0.08)"; g.lineWidth = W * 0.004; for (let i = 0; i < 40; i++) { const a = i * 2.39996 + lt * 0.4, r0 = W * (0.25 + ((i * 0.37 + lt * 1.6) % 1) * 0.9); g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * (r0 + W * 0.18), Math.sin(a) * (r0 + W * 0.18)); g.stroke(); } g.restore();
    const font = (px, w) => `${w || 900} ${px}px Inter, "Arial Black", sans-serif`;
    if (seg.k === "title") { const bots = (seg.r.step.bots || []).map((b) => (E.botPick ? E.botPick.name(b) : b)); g.textAlign = "center"; g.fillStyle = "rgba(255,255,255,0.85)"; g.font = font(W * 0.05, 800); g.fillText("TOI  ×  " + bots.join("  ·  ").toUpperCase(), W / 2, H * 0.62); }
    if (seg.k === "money") { const c = seg.c, im = res.art && res.art[c.art]; if (im) { const z = 1.05 + lt * 0.05, s = W * 0.8 * z; g.save(); g.globalAlpha = 0.9; g.drawImage(im, (W - s) / 2, H * 0.12, s, s); g.restore(); }
      const amt = c.amount ? Math.round(c.amount * out3(lt / Math.min(0.6, d * 0.4))) : 0; g.textAlign = "center"; g.font = font(W * 0.16); g.fillStyle = "#ff2d55"; g.shadowColor = "#ff0033"; g.shadowBlur = W * 0.05;
      if (c.amount) g.fillText("−" + String(amt).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " €", W / 2, H * 0.72); g.shadowBlur = 0; g.font = font(W * 0.045, 700); g.fillStyle = "#ffd27a"; g.fillText((c.city || c.sub || "").toUpperCase(), W / 2, H * 0.8); }
    if (seg.k === "outro") { g.textAlign = "left"; seg.results.forEach((r, i) => { const a = out3((lt - 0.3 - i * 0.12) / 0.3); if (a <= 0) return; const y = H * 0.6 + i * H * 0.055; g.globalAlpha = a; g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(W * 0.1, y - H * 0.022, W * 0.8, H * 0.044);
      g.fillStyle = "#fff"; g.font = font(W * 0.042, 800); g.fillText(GNAME[r.step.g] || r.step.g, W * 0.13, y + W * 0.014); g.textAlign = "right"; const ok = r.res.won || /1-0/.test(r.res.chess ? r.res.chess.result || "" : ""); g.fillStyle = ok ? "#4ade80" : "#ff6d88"; g.fillText(r.res.chess ? (r.res.chess.result || "") : ok ? "VICTOIRE" : "DÉFAITE", W * 0.87, y + W * 0.014); g.textAlign = "left"; g.globalAlpha = 1; }); }
  }

  function drawRecap(g, W, H, results, lt) {
    const font = (px, w) => `${w || 900} ${px}px Inter, "Arial Black", sans-serif`;
    results.forEach((r, i) => { const a = out3((lt - 0.5 - i * 0.12) / 0.35); if (a <= 0) return; const y = H * 0.66 + i * H * 0.058; g.globalAlpha = a; g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(W * 0.08, y - H * 0.024, W * 0.84, H * 0.048);
      g.fillStyle = "#ff2d55"; g.fillRect(W * 0.08, y - H * 0.024, W * 0.012, H * 0.048);
      g.textAlign = "left"; g.fillStyle = "#fff"; g.font = font(W * 0.046, 800); g.fillText(GNAME[r.step.g] || r.step.g.toUpperCase(), W * 0.13, y + W * 0.016);
      g.textAlign = "right"; const ok = r.res.won || /1-0/.test(r.res.chess ? r.res.chess.result || "" : ""); g.fillStyle = ok ? "#4ade80" : "#ff6d88"; g.fillText(r.res.chess ? (r.res.chess.result || "") : ok ? "VICTOIRE" : "DÉFAITE", W * 0.88, y + W * 0.016); g.globalAlpha = 1; });
  }

  // ------------------------------------------------------------------ encodeurs
  async function pickVideo(W, H, fps) { const list = [["hevc", "hvc1.1.6.L" + (W * H > 8912896 ? 183 : W * H > 2228224 ? 156 : 123) + ".B0"], ["avc", W * H > 2228224 ? "avc1.640034" : "avc1.64002a"], ["avc", "avc1.4d0034"]];
    for (const [name, codec] of list) { const bitrate = Math.round(W * H * fps * (name === "hevc" ? 0.05 : 0.08)); /* 4K 60 : ~25 Mb/s HEVC, ~40 Mb/s H.264 */ try { const r = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate, framerate: fps, ...(name === "avc" ? { avc: { format: "avc" } } : { hevc: { format: "hevc" } }) }); if (r && r.supported) return { name, codec, bitrate }; } catch (e) { /* suivant */ } } return null; }
  async function pickAudio() { for (const [name, codec] of [["aac", "mp4a.40.2"], ["opus", "opus"]]) { try { const r = await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 }); if (r && r.supported) return { name, codec }; } catch (e) { /* suivant */ } } return null; }

  // ------------------------------------------------------------------ rendu complet
  R.render = async (results, o) => {
    o = o || {}; const prog = o.onProgress || (() => {}), stop = () => o.signal && o.signal.stop;
    if (typeof VideoEncoder !== "function" || typeof Mp4Muxer !== "object") throw new Error("Cet appareil ne sait pas encoder de vidéo (WebCodecs).");
    const T = await E.g3d.ready(); await E.g3d.extras(); if (E.editFonts) await E.editFonts.ready();
    prog(0.01, "Analyse de la musique…");
    const natural = 3 + results.reduce((a, r) => a + 2 + (r.clips || []).length * 4.5 + (r.res.chess ? 12 : 0), 0);
    const mus = await musicPlan(o.music || null, natural);
    const plan = R.plan(results, mus), D = plan.D;
    if (plan.segs.length < 2) throw new Error("Aucun moment à monter.");
    // résolution : 4K si l'encodeur suit, sinon 1080p
    let W = o.quality === "1080" ? 1080 : o.quality === "540" ? 540 : 2160, H = W * 16 / 9; let vc = await pickVideo(W, H, FPS);                // 540 : réservé aux tests automatiques
    if (!vc && W === 2160) { W = 1080; H = 1920; vc = await pickVideo(W, H, FPS); }
    if (!vc) throw new Error("Aucun encodeur vidéo disponible.");
    prog(0.03, "Mixage du son…"); const ac = typeof AudioEncoder === "function" ? await pickAudio() : null; const sfx = sfxList(plan); let mixed = null; try { mixed = await mixAudio(mus, plan, sfx); } catch (e) { mixed = null; }
    // moteur de rendu partagé (une seule carte graphique pour tout), hors écran
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const renderer = new T.WebGLRenderer({ canvas: cv, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" }); renderer.setPixelRatio(1); renderer.setSize(W, H, false);
    const cw = W / 2, ch = H / 2, card = Object.assign(document.createElement("canvas"), { width: cw, height: ch }), cg = card.getContext("2d"), cardTex = new T.CanvasTexture(card);
    const tcv = Object.assign(document.createElement("canvas"), { width: cw, height: ch }), tg = tcv.getContext("2d"), textTex = new T.CanvasTexture(tcv);
    [cardTex, textTex].forEach((x) => { x.colorSpace = T.NoColorSpace; x.flipY = true; x.generateMipmaps = false; x.minFilter = T.LinearFilter; });
    const subjRT = new T.WebGLRenderTarget(W, H, { type: T.HalfFloatType });
    const U = { tScene: { value: cardTex }, tSubj: { value: subjRT.texture }, tText: { value: textTex }, uLinScene: { value: 0 }, uHasSubj: { value: 0 }, uBehind: { value: 0 }, uRGB: { value: 0 }, uZoom: { value: 0 }, uFlash: { value: 0 }, uIso: { value: 0 }, uTime: { value: 0 }, uGrain: { value: 0.035 }, uVig: { value: 0.45 }, uSat: { value: 1.12 }, uCon: { value: 1.12 }, uFade: { value: 1 }, uRed: { value: 1 }, uShake: { value: new T.Vector2() }, uCenter: { value: new T.Vector2(0.5, 0.5) } };
    const fxScene = new T.Scene(), fxCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1); fxScene.add(new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false })));
    // ressources 2D (images embarquées seulement)
    const res = { art: {} }; if (E.g3d.pack) { await E.g3d.pack("neocite"); for (const s of plan.segs) if (s.k === "money" && s.c.art && !res.art[s.c.art]) res.art[s.c.art] = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = E.g3d.src("img/games/capital/lots/" + s.c.art + ".webp"); }); }
    // échecs : timeline Chess Edit
    const chessCache = new Map();
    for (const s of plan.segs) if (s.k === "chess") { const sh = chessCache.get(s.rec); if (sh) { Object.assign(s, sh); continue; } try { const Mp = E.editMap, plies = Mp.gamePlies(s.rec); s.tl = Mp.buildViral(plies, s.rec, null, { voices: false, intro: false, keepTwist: true, syncDrop: false, synth: true, opening: "" }); s.cc = Object.assign(document.createElement("canvas"), { width: 1080, height: 1920 }); s.R = new E.editRender.Renderer(s.cc, s.tl, { rec: s.rec }); await s.R.load(); s.tex = new T.CanvasTexture(s.cc); s.tex.colorSpace = T.NoColorSpace; chessCache.set(s.rec, { tl: s.tl, cc: s.cc, R: s.R, tex: s.tex }); } catch (e) { s.k = "title"; s.r = { step: { bots: [] } }; } }
    // encodeur + muxer
    // le fichier s'écrit au fil de l'eau (morceaux de 4 Mo) au lieu d'un seul tampon qui double de taille : moitié moins de mémoire en 4K
    const parts = [], write = (data, pos) => { let end = parts.length ? parts[parts.length - 1].pos + parts[parts.length - 1].data.length : 0;
      if (pos < end) { for (let i = parts.length - 1; i >= 0; i--) { const q = parts[i], a = Math.max(pos, q.pos), b = Math.min(pos + data.length, q.pos + q.data.length); if (b > a) q.data.set(data.subarray(a - pos, b - pos), a - q.pos); if (q.pos <= pos) break; }
        if (pos + data.length <= end) return; data = data.subarray(end - pos); pos = end; }
      parts.push({ pos, data: data.slice() }); };
    const target = new Mp4Muxer.StreamTarget({ onData: (d, p) => write(d, p), chunked: true, chunkSize: 4 * 1024 * 1024 }), muxer = new Mp4Muxer.Muxer({ target, fastStart: false, video: { codec: vc.name, width: W, height: H, frameRate: FPS }, audio: mixed && ac ? { codec: ac.name, numberOfChannels: 2, sampleRate: 48000 } : undefined });
    let err = null; const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (err = e) });
    venc.configure({ codec: vc.codec, width: W, height: H, bitrate: vc.bitrate, framerate: FPS, bitrateMode: "variable", latencyMode: "quality", ...(vc.name === "avc" ? { avc: { format: "avc" } } : { hevc: { format: "hevc" } }) });
    // rejeu : une instance de jeu (mode « rejeu ») par moment, recréée quand la scène change
    let inst = null, instKey = "";
    const fake = (rec) => { const d = () => document.createElement("div"); return { setup: {}, stage: d(), host: d(), hud: d(), turn() {}, toast() {}, vibrate() {}, sound() {}, sfx: () => false, loop() {}, end() {}, ambience() {}, crowd: (th) => ["eto", "stade"].includes(th),
      clip: { begin() {}, mark() {}, cancel() {}, active: () => false, end() {}, event() {}, note() {}, track: (l, c) => { rec.list = l; rec.cam = c; } } }; };
    const openInst = async (seg) => { const m = seg.c.meta || {}, key = seg.g + JSON.stringify(m); if (inst && instKey === key) return inst;
      if (inst) { try { inst.game.destroy(); } catch (e) { /* rien */ } inst = null; }
      const g = (E.jeux.list || []).find((x) => x.id === seg.g); if (!g) return null;
      const rec = {}; E.g3d.replayCtx = { renderer, size: [W, H] };
      try { const setup = { mode: "bots", players: m.players || [{ name: "Toi", human: true }, { name: "ETO", human: false }], opts: m.opts || {}, replay: { k: m.k || 0 }, level: "normal" }; const api = fake(rec); api.setup = setup;
        const game = await g.start(document.createElement("div"), setup, api); inst = { game, rec, rp: game && game.replay, tm: renderer.toneMapping, exp: renderer.toneMappingExposure }; instKey = key; }
      finally { E.g3d.replayCtx = null; }
      return inst; };
    const q0 = new T.Quaternion(), q1 = new T.Quaternion();
    const applyAt = (seg, gt) => { const fr = seg.c.rp.frames, n = seg.c.rp.n; let lo = 0, hi = fr.length - 1; if (gt <= fr[0].t) hi = 0; else if (gt >= fr[hi].t) lo = hi; else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (fr[m].t <= gt) lo = m; else hi = m; } }
      const A = fr[lo].d, Bd = fr[hi].d, k = hi === lo ? 0 : (gt - fr[lo].t) / Math.max(1e-6, fr[hi].t - fr[lo].t), list = inst.rec.list || [];
      for (let i = 0; i < Math.min(n, list.length); i++) { const o2 = list[i], j = i * 9; o2.position.set(lerp(A[j], Bd[j], k), lerp(A[j + 1], Bd[j + 1], k), lerp(A[j + 2], Bd[j + 2], k)); q0.set(A[j + 3], A[j + 4], A[j + 5], A[j + 6]); q1.set(Bd[j + 3], Bd[j + 4], Bd[j + 5], Bd[j + 6]); o2.quaternion.copy(q0.slerp(q1, k)); const s = lerp(A[j + 7], Bd[j + 7], k); o2.scale.setScalar(s || 1); o2.visible = (k < 0.5 ? A[j + 8] : Bd[j + 8]) > 0.5; }
      const cam = inst.rec.cam; if (cam && seg.c.rp.cam) { const j = n * 9; cam.position.set(lerp(A[j], Bd[j], k), lerp(A[j + 1], Bd[j + 1], k), lerp(A[j + 2], Bd[j + 2], k)); q0.set(A[j + 3], A[j + 4], A[j + 5], A[j + 6]); q1.set(Bd[j + 3], Bd[j + 4], Bd[j + 5], Bd[j + 6]); cam.quaternion.copy(q0.slerp(q1, k)); cam.fov = lerp(A[j + 7], Bd[j + 7], k); cam.aspect = W / H; cam.updateProjectionMatrix(); } };
    // caméra : « game » = celle de la partie, rapprochée et tournée vers la balle ; « chase » = derrière la balle ; « orbit » = tour lent autour d'elle
    const V = () => new T.Vector3(), up = new T.Vector3(0, 1, 0), m4 = new T.Matrix4(), qL = new T.Quaternion(), tmpA = V(), tmpB = V();
    const posAt = (seg, i, gt, out) => { const fr = seg.c.rp.frames; let lo = 0, hi = fr.length - 1; if (gt <= fr[0].t) hi = 0; else if (gt >= fr[hi].t) lo = hi; else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (fr[m].t <= gt) lo = m; else hi = m; } }
      const k = hi === lo ? 0 : (gt - fr[lo].t) / Math.max(1e-6, fr[hi].t - fr[lo].t), A = fr[lo].d, Bd = fr[hi].d, j = i * 9; return out.set(lerp(A[j], Bd[j], k), lerp(A[j + 1], Bd[j + 1], k), lerp(A[j + 2], Bd[j + 2], k)); };
    const cineCam = (seg, ins, cam, subj, gt, lt) => {
      const list = ins.rec.list || [], si = list.indexOf(subj); if (si < 0) return null;
      const bp = V(); for (let i = -2; i <= 2; i++) bp.add(posAt(seg, si, gt + i * 0.06, tmpA)); bp.multiplyScalar(0.2); if (subj.parent) { subj.parent.updateMatrixWorld(true); bp.applyMatrix4(subj.parent.matrixWorld); }
      const R0 = clamp(cam.position.distanceTo(bp), 1, 60), mode = seg.cam || "game";
      if (mode === "game") { cam.position.lerp(bp, 0.28); m4.lookAt(cam.position, bp, up); qL.setFromRotationMatrix(m4); cam.quaternion.slerp(qL, 0.5); }
      else {
        let pos;
        if (mode === "chase") { const d = posAt(seg, si, gt + 0.35, tmpB).sub(posAt(seg, si, gt - 0.6, tmpA)); d.y = 0; if (d.lengthSq() < 1e-4) { d.copy(bp).sub(cam.position); d.y = 0; } d.normalize(); seg._dir = seg._dir ? seg._dir.lerp(d, 0.08).normalize() : d.clone();
          pos = bp.clone().addScaledVector(seg._dir, -R0 * 0.42).addScaledVector(up, R0 * 0.2); cam.fov = 52; }
        else { const a = seg.orb0 + lt * 0.55, r = R0 * 0.4; pos = bp.clone().add(tmpA.set(Math.cos(a) * r, R0 * 0.17, Math.sin(a) * r)); cam.fov = 46; }
        pos.y = Math.max(pos.y, bp.y + R0 * 0.08); cam.position.copy(pos); m4.lookAt(cam.position, bp, up); cam.quaternion.setFromRotationMatrix(m4);
      }
      cam.aspect = W / H; cam.updateProjectionMatrix(); return bp; };
    const subjPass = (S, subjects) => { const keep = new Set(); subjects.forEach((s) => { let o2 = s; while (o2) { keep.add(o2); o2 = o2.parent; } s.traverse((c) => keep.add(c)); });
      const saved = []; S.scene.traverse((o2) => { if (o2 === S.scene || keep.has(o2) || o2.isLight) return; if (o2.visible) { saved.push(o2); o2.visible = false; } });
      const bg = S.scene.background, fog = S.scene.fog; S.scene.background = null; S.scene.fog = null; renderer.setRenderTarget(subjRT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(S.scene, S.camera); renderer.setRenderTarget(null);
      S.scene.background = bg; S.scene.fog = fog; saved.forEach((o2) => (o2.visible = true)); };
    // ---------------------------------------------------------------- boucle image par image
    const N = Math.round(D * FPS); let lastSeg = null, lastGt = 0, textOn = false;
    prog(0.05, "Rendu de l'edit…");
    for (let f = 0; f < N; f++) {
      if (stop()) { try { venc.close(); } catch (e) { /* rien */ } if (inst) inst.game.destroy(); renderer.dispose(); throw new Error("Montage annulé."); }
      if (err) throw err;
      const t = f / FPS, seg = plan.segs.find((s) => t >= s.t0 && t < s.t1) || plan.segs[plan.segs.length - 1], lt = t - seg.t0;
      // impulsions : chaque choc calé sur un temps
      let pulse = 0, flash = 0; if (seg.syncs) for (const { e, T: te } of seg.syncs) { if (t >= te) { const dt = t - te; pulse = Math.max(pulse, Math.exp(-dt * 7) * (SYNC[e.k] > 1 ? 1 : 0.6 + 0.4 * (e.v || 0.5))); if (SYNC[e.k] > 1) flash = Math.max(flash, 1 - dt / 0.16); } }
      { const bb = nextBeat(mus.beats, t - 0.16); if (bb != null && bb <= t) pulse = Math.max(pulse, Math.exp(-(t - bb) * 12) * 0.25); }
      if (seg !== lastSeg && lt < 1 / FPS + 1e-6) flash = Math.max(flash, 0.55);
      U.uIso.value = 0; U.uHasSubj.value = 0; U.uBehind.value = 0; U.uLinScene.value = 0;
      if (seg.k === "replay") {
        const ins = await openInst(seg);
        if (ins && ins.rp) { const S = ins.rp.S, gt = gtAt(seg, t);
          renderer.toneMapping = ins.tm; renderer.toneMappingExposure = ins.exp;
          S.step(1 / FPS, t); applyAt(seg, gt);
          if (ins.rp.fx && seg === lastSeg) for (const e of seg.c.rp.events) if (e.t > lastGt && e.t <= gt) ins.rp.fx(e);
          lastGt = gt;
          // caméra : coup de poing vers le sujet à chaque choc
          const cam = ins.rec.cam || S.camera, subj = ins.rp.subjects && ins.rp.subjects[0];
          const bp = subj ? cineCam(seg, ins, cam, subj, gt, lt) : null;
          if (subj && pulse > 0.01) { const sp = bp || subj.getWorldPosition(new T.Vector3()); cam.position.lerp(sp, 0.12 * pulse); cam.fov *= 1 - 0.12 * pulse; cam.updateProjectionMatrix(); const pr = sp.clone().project(cam); U.uCenter.value.set(clamp(pr.x * 0.5 + 0.5, 0.2, 0.8), clamp(pr.y * 0.5 + 0.5, 0.2, 0.8)); } else U.uCenter.value.set(0.5, 0.5);
          U.tScene.value = S.renderTex(); U.uLinScene.value = S.bloom && S.bloom() ? 0 : 1;
          const frz = seg.freeze && t >= seg.freeze[0] && t < seg.freeze[1];
          textOn = drawWords(tg, cw, ch, plan.words, t, mus.beats); if (seg.outro) { drawRecap(tg, cw, ch, seg.results, lt); textOn = true; }
          if ((frz || textOn) && ins.rp.subjects) { subjPass(S, ins.rp.subjects); U.uHasSubj.value = 1; U.uBehind.value = textOn ? 1 : 0; U.uIso.value = frz ? 1 : 0; } } }
      else if (seg.k === "chess") { seg.R.draw(Math.min((seg.from || 0) + lt, seg.tl.duration - 0.01)); seg.tex.needsUpdate = true; U.tScene.value = seg.tex; textOn = drawWords(tg, cw, ch, plan.words, t, mus.beats); }
      else { drawCard(cg, cw, ch, seg, t, res); cardTex.needsUpdate = true; U.tScene.value = cardTex; textOn = drawWords(tg, cw, ch, plan.words, t, mus.beats); }
      if (seg !== lastSeg) { lastSeg = seg; lastGt = seg.k === "replay" ? gtAt(seg, t) : 0; }
      textTex.needsUpdate = true;
      U.uRGB.value = 0.0015 + 0.012 * pulse; U.uZoom.value = 0.08 + 0.9 * pulse; U.uFlash.value = clamp(flash, 0, 1) * 0.85; U.uTime.value = t;
      U.uShake.value.set((Math.random() - 0.5) * 0.012 * pulse, (Math.random() - 0.5) * 0.012 * pulse);
      U.uFade.value = Math.min(1, t / 0.25, (D - t) / 0.6);
      renderer.setRenderTarget(null); renderer.render(fxScene, fxCam);
      const vf = new VideoFrame(cv, { timestamp: Math.round((f * 1e6) / FPS), duration: Math.round(1e6 / FPS) }); venc.encode(vf, { keyFrame: f % (FPS * 2) === 0 }); vf.close();
      while (venc.encodeQueueSize > 4) await new Promise((r) => { venc.addEventListener("dequeue", r, { once: true }); tick().then(() => setTimeout(r, 30)); });
      if (f % 4 === 0) { prog(0.05 + 0.88 * (f / N), `Rendu de l'edit : ${Math.round((100 * f) / N)} %`); await tick(); }
    }
    await venc.flush(); venc.close(); if (err) throw err;
    if (inst) { try { inst.game.destroy(); } catch (e) { /* rien */ } }
    if (mixed && ac) { prog(0.95, "Encodage du son…"); const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (err = e) }); aenc.configure({ codec: ac.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
      const L = mixed.getChannelData(0), Rr = mixed.getChannelData(1), NS = 4096; for (let p = 0; p < L.length; p += NS) { const n = Math.min(NS, L.length - p), data = new Float32Array(n * 2); data.set(L.subarray(p, p + n), 0); data.set(Rr.subarray(p, p + n), n);
        const ad = new AudioData({ format: "f32-planar", sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((p / 48000) * 1e6), data }); aenc.encode(ad); ad.close(); if (aenc.encodeQueueSize > 20) await tick(); }
      await aenc.flush(); aenc.close(); }
    muxer.finalize(); renderer.dispose(); subjRT.dispose(); prog(1, "Terminé");
    return { blob: new Blob(parts.map((x) => x.data), { type: "video/mp4" }), mime: "video/mp4", duration: D, w: W, h: H, codec: vc.name, frames: N, sfx: sfx.length, beats: mus.beats.length, gen: mus.gen };
  };
})();
