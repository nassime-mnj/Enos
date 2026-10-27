"use strict";
// MODE CHILL (téléphone, sans PC) : ambiances sonores GÉNÉRÉES par WebAudio (pluie, orage, vent, vagues, feu de cheminée, bruit brun) à mélanger, minuteur de sommeil
// avec fondu, et lecteur de tes propres musiques (fichiers choisis sur le téléphone). Aucun fichier à télécharger, aucun réseau.
(() => {
  const E = window.ENOS;
  const LAYERS = [
    { id: "rain", n: "Pluie", i: "🌧" }, { id: "thunder", n: "Orage lointain", i: "⛈" }, { id: "wind", n: "Vent", i: "🍃" },
    { id: "waves", n: "Vagues", i: "🌊" }, { id: "fire", n: "Feu de cheminée", i: "🔥" }, { id: "brown", n: "Bruit brun", i: "〰" },
  ];

  E.suite.register({
    id: "chill", group: "pro", title: "Mode Chill", sub: "Ambiances · minuteur · musique",
    icon: '<path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 1.5A4 4 0 0 0 6.5 19z"/>',
    build(el, A) {
      const $ = (s) => el.querySelector(s);
      let ctx = null, master = null, noise = {}, nodes = {}, timers = [], sleepT = 0, sleepEnd = 0, tick = 0;
      const mix = E.settings.get("chill.mix", { rain: 55 });
      el.innerHTML = `
        <div class="card"><h3>Ambiances</h3>
          <div class="list" id="cl-layers">${LAYERS.map((l) => `<div class="cl-l"><span class="cl-i">${l.i}</span><span class="cl-n">${l.n}</span><input type="range" data-l="${l.id}" min="0" max="100" value="${mix[l.id] || 0}" aria-label="${l.n}"></div>`).join("")}</div>
          <label class="fld" style="margin-top:10px">Volume général<b id="cl-mv"></b></label><input type="range" id="cl-m" min="0" max="100" value="${E.settings.get("chill.vol", 70)}" style="width:100%;accent-color:var(--red)">
          <div class="row" style="margin-top:8px"><button class="btn pri" id="cl-go">▶ LANCER</button><button class="btn" id="cl-stop">■ ARRÊTER</button></div></div>
        <div class="card"><h3>Minuteur de sommeil<span class="sp" id="cl-left"></span></h3>
          <div class="row" id="cl-sleep">${[15, 30, 60, 90].map((m) => `<button class="btn" data-m="${m}">${m} MIN</button>`).join("")}<button class="btn" data-m="0">SANS</button></div>
          <p class="muted" style="font-size:12.5px;margin-top:6px">Le son s'éteint en douceur à la fin du minuteur.</p></div>
        <div class="card"><h3>Mes musiques<span class="sp" id="cl-tn"></span></h3>
          <div class="row"><button class="btn" id="cl-add">AJOUTER DES FICHIERS</button></div>
          <audio id="cl-audio" controls style="width:100%;margin-top:10px" hidden></audio><div class="list" id="cl-tracks" style="margin-top:6px"></div></div>`;

      // ---- bruits de base
      function mkNoise(kind) {
        const r = ctx.sampleRate, b = ctx.createBuffer(1, r * 4, r), d = b.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0, last = 0;
        for (let i = 0; i < d.length; i++) {
          const w = Math.random() * 2 - 1;
          if (kind === "white") d[i] = w;
          else if (kind === "pink") { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
          else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        }
        return b;
      }
      const src = (kind) => { const s = ctx.createBufferSource(); s.buffer = noise[kind]; s.loop = true; s.start(Math.random() * 3); return s; };
      const filt = (type, f, q) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q) n.Q.value = q; return n; };
      const lfo = (rate, depth, target) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = rate; g.gain.value = depth; o.connect(g); g.connect(target); o.start(); return o; };
      const every = (fn, minMs, maxMs) => { const loop = () => { fn(); timers.push(setTimeout(loop, minMs + Math.random() * (maxMs - minMs))); }; timers.push(setTimeout(loop, minMs)); };
      const burst = (out, freq, q, vol, dur) => {                      // petit claquement : bruit blanc filtré, enveloppe courte
        const s = ctx.createBufferSource(); s.buffer = noise.white; const f = filt("bandpass", freq, q), g = ctx.createGain(), t = ctx.currentTime;
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 3, dur + 0.05);
      };

      const BUILD = {
        rain(out) { const s = src("pink"), hp = filt("highpass", 500), lp = filt("lowpass", 9000); s.connect(hp); hp.connect(lp); lp.connect(out); every(() => burst(out, 2500 + Math.random() * 4000, 3, 0.18, 0.04), 35, 90); },
        thunder(out) { const s = src("brown"), lp = filt("lowpass", 110), g = ctx.createGain(); g.gain.value = 0.05; s.connect(lp); lp.connect(g); g.connect(out);
          every(() => { const t = ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.05, t); g.gain.linearRampToValueAtTime(1.4, t + 0.6 + Math.random()); g.gain.exponentialRampToValueAtTime(0.05, t + 5 + Math.random() * 4); }, 9000, 30000); },
        wind(out) { const s = src("brown"), bp = filt("bandpass", 420, 0.7), g = ctx.createGain(); g.gain.value = 0.7; s.connect(bp); bp.connect(g); g.connect(out); lfo(0.07, 0.45, g.gain); lfo(0.05, 250, bp.frequency); },
        waves(out) { const s = src("pink"), lp = filt("lowpass", 900), g = ctx.createGain(); g.gain.value = 0.55; s.connect(lp); lp.connect(g); g.connect(out); lfo(0.11, 0.45, g.gain); },
        fire(out) { const s = src("brown"), lp = filt("lowpass", 260), g = ctx.createGain(); g.gain.value = 0.5; s.connect(lp); lp.connect(g); g.connect(out); every(() => burst(out, 1200 + Math.random() * 3500, 6, 0.4 + Math.random() * 0.6, 0.02 + Math.random() * 0.05), 60, 420); },
        brown(out) { const s = src("brown"); s.connect(out); },
      };
      function ensure() {
        if (ctx) return;
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = $("#cl-m").value / 100; master.connect(ctx.destination);
        ["white", "pink", "brown"].forEach((k) => (noise[k] = mkNoise(k)));
      }
      const vol = (id) => Math.pow($(`[data-l=${id}]`).value / 100, 1.6);
      function startLayer(id) {
        if (nodes[id]) return;
        const out = ctx.createGain(); out.gain.value = vol(id); out.connect(master); nodes[id] = out; BUILD[id](out);
      }
      function stopAll(fade) {
        timers.forEach(clearTimeout); timers = [];
        if (!ctx) return;
        const old = ctx, t = old.currentTime; ctx = null; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(0, t + (fade || 0.3));
        nodes = {}; setTimeout(() => old.close().catch(() => {}), (fade || 0.3) * 1000 + 200);
        $("#cl-go").textContent = "▶ LANCER";
      }
      function apply() {
        const m = {}; el.querySelectorAll("[data-l]").forEach((r) => { m[r.dataset.l] = +r.value; });
        E.settings.set("chill.mix", m);
        if (!ctx) return;
        LAYERS.forEach((l) => { if (m[l.id] > 0) startLayer(l.id); if (nodes[l.id]) nodes[l.id].gain.setTargetAtTime(vol(l.id), ctx.currentTime, 0.05); });
      }
      el.querySelectorAll("[data-l]").forEach((r) => (r.oninput = apply));
      $("#cl-m").oninput = () => { $("#cl-mv").textContent = $("#cl-m").value + " %"; E.settings.set("chill.vol", +$("#cl-m").value); if (ctx) master.gain.setTargetAtTime($("#cl-m").value / 100, ctx.currentTime, 0.05); };
      $("#cl-mv").textContent = $("#cl-m").value + " %";
      $("#cl-go").onclick = () => { if (ctx) return stopAll(); ensure(); ctx.resume(); $("#cl-go").textContent = "⏸ PAUSE"; apply(); };
      $("#cl-stop").onclick = () => { stopAll(0.6); setSleep(0); };

      function setSleep(min) {
        clearTimeout(sleepT); clearInterval(tick); $("#cl-left").textContent = "";
        el.querySelectorAll("#cl-sleep button").forEach((b) => b.classList.toggle("on", +b.dataset.m === min && min > 0));
        if (!min) return;
        sleepEnd = Date.now() + min * 60000;
        sleepT = setTimeout(() => { stopAll(8); const a = $("#cl-audio"); a.pause(); setSleep(0); }, min * 60000);
        tick = setInterval(() => { const s = Math.max(0, Math.round((sleepEnd - Date.now()) / 1000)); $("#cl-left").textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }, 1000);
      }
      $("#cl-sleep").onclick = (e) => { const b = e.target.closest("[data-m]"); if (b) setSleep(+b.dataset.m); };

      // ---- musiques perso
      let tracks = [];
      $("#cl-add").onclick = async () => {
        const fs = await A.pick({ accept: "audio/*", multiple: true });
        fs.forEach((f) => tracks.push({ name: f.name.replace(/\.[^.]+$/, ""), url: URL.createObjectURL(f) }));
        renderTracks(); if (fs.length && $("#cl-audio").paused && !$("#cl-audio").src) play(tracks.length - fs.length);
      };
      function renderTracks() {
        $("#cl-tn").textContent = tracks.length ? tracks.length + " piste" + (tracks.length > 1 ? "s" : "") : "";
        $("#cl-tracks").innerHTML = tracks.map((t, i) => `<div class="it" data-t="${i}"><span class="n">${E.esc(t.name)}</span><span class="tag">▶</span></div>`).join("");
      }
      function play(i) { const a = $("#cl-audio"); a.hidden = false; a.src = tracks[i].url; a.dataset.i = i; a.play().catch(() => {}); }
      $("#cl-tracks").onclick = (e) => { const it = e.target.closest("[data-t]"); if (it) play(+it.dataset.t); };
      $("#cl-audio").onended = () => { const i = (+$("#cl-audio").dataset.i + 1) % tracks.length; play(i); };
      el._api = { get ctx() { return ctx; }, apply, stopAll, setSleep };
    },
  });
})();
