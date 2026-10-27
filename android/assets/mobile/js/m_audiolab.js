"use strict";
// LABO AUDIO (téléphone, sans PC) : ouvre un fichier audio OU une vidéo (le son est extrait), forme d'onde, sélection, gain / normalisation / fondus, découpe automatique
// des sons (silences) pour isoler les effets sonores, export en WAV. Tout se fait dans le téléphone (WebAudio) : rien n'est envoyé.
(() => {
  const E = window.ENOS, esc = E.esc;

  const wav = (chans, rate) => {                                   // Float32Array[] -> WAV 16 bits entrelacé
    const n = chans[0].length, nc = chans.length, buf = new ArrayBuffer(44 + n * nc * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + n * nc * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * nc * 2, true);
    let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    return new Uint8Array(buf);
  };
  const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ":" + (s % 60).toFixed(2).padStart(5, "0"); };

  /** Effets sur une copie des échantillons : gain (dB), normalisation (pic -1 dB), fondus (s). Pure : testable. */
  const process = (chans, rate, o) => chans.map((ch) => {
    const out = Float32Array.from(ch), n = out.length;
    let g = Math.pow(10, (o.gain || 0) / 20);
    if (o.normalize) { let pk = 0; for (const c of chans) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > pk) pk = a; } if (pk > 0) g *= 0.891 / pk; }
    const fi = Math.round((o.fadeIn || 0) * rate), fo = Math.round((o.fadeOut || 0) * rate);
    for (let i = 0; i < n; i++) {
      let k = g;
      if (fi && i < fi) k *= i / fi;
      if (fo && i > n - fo) k *= (n - i) / fo;
      out[i] *= k;
    }
    return out;
  });
  /** Segments sonores séparés par des silences : [{a, b}] en secondes. */
  const split = (chans, rate, thrDb, minSil, minSeg) => {
    const win = Math.round(rate * 0.02), n = chans[0].length, thr = Math.pow(10, thrDb / 20), act = [];
    for (let i = 0; i + win <= n; i += win) { let s = 0; for (const c of chans) for (let j = i; j < i + win; j++) s += c[j] * c[j]; act.push(Math.sqrt(s / (win * chans.length)) > thr); }
    const segs = []; let st = -1, gap = 0;
    act.forEach((a, i) => {
      if (a) { if (st < 0) st = i; gap = 0; }
      else if (st >= 0) { gap++; if (gap * 0.02 >= minSil) { segs.push([st, i - gap + 1]); st = -1; gap = 0; } }
    });
    if (st >= 0) segs.push([st, act.length]);
    return segs.map(([a, b]) => ({ a: Math.max(0, a * 0.02 - 0.03), b: Math.min(n / rate, b * 0.02 + 0.05) })).filter((s) => s.b - s.a >= minSeg);
  };
  E.audioLab = { wav, process, split };

  E.suite.register({
    id: "audiolab", group: "pro", title: "Labo audio", sub: "Vidéo → WAV · découpe · effets",
    icon: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2M22 12h-1"/>',
    build(el, A) {
      const $ = (s) => el.querySelector(s);
      let ctx = null, buf = null, name = "audio", src = null, t0 = 0, startAt = 0, raf = 0, segs = [];
      el.innerHTML = `
        <div class="card"><h3>Fichier</h3>
          <p class="muted" style="font-size:14px;margin-bottom:10px">Choisis un son ou une vidéo : la piste audio est extraite sur ton téléphone.</p>
          <div class="row"><button class="btn pri" id="al-pick">CHOISIR UN FICHIER</button></div><div class="muted" id="al-info" style="margin-top:8px;font-size:13px"></div></div>
        <div id="al-main" hidden>
          <div class="card"><canvas id="al-wave" height="130" style="width:100%;border-radius:10px;background:#08080a;touch-action:none"></canvas>
            <label class="fld">Début<b id="al-av"></b></label><input type="range" id="al-a" min="0" max="1000" value="0" style="width:100%;accent-color:var(--red)">
            <label class="fld">Fin<b id="al-bv"></b></label><input type="range" id="al-b" min="0" max="1000" value="1000" style="width:100%;accent-color:var(--red)">
            <div class="row" style="margin-top:8px"><button class="btn" id="al-play">▶ ÉCOUTER LA SÉLECTION</button><button class="btn" id="al-stop">■</button></div></div>
          <div class="card"><h3>Effets</h3>
            <label class="fld">Gain<b id="al-gv">0 dB</b></label><input type="range" id="al-g" min="-24" max="24" value="0" style="width:100%;accent-color:var(--red)">
            <label class="fld">Fondu d'entrée<b id="al-fiv">0 s</b></label><input type="range" id="al-fi" min="0" max="50" value="0" style="width:100%;accent-color:var(--red)">
            <label class="fld">Fondu de sortie<b id="al-fov">0 s</b></label><input type="range" id="al-fo" min="0" max="50" value="0" style="width:100%;accent-color:var(--red)">
            <label class="chip2" style="display:inline-flex;gap:8px;margin:8px 0"><input type="checkbox" id="al-norm"> Normaliser (pic à −1 dB)</label>
            <label class="chip2" style="display:inline-flex;gap:8px;margin:0 0 8px 12px"><input type="checkbox" id="al-mono"> Mono</label>
            <div class="row"><button class="btn pri" id="al-save">ENREGISTRER EN WAV</button></div></div>
          <div class="card"><h3>Détecter les sons<span class="sp" id="al-sn"></span></h3>
            <p class="muted" style="font-size:13.5px;margin-bottom:8px">Sépare automatiquement les effets sonores (coupures aux silences) pour les enregistrer un par un.</p>
            <label class="fld">Seuil de silence<b id="al-tv">−45 dB</b></label><input type="range" id="al-t" min="-70" max="-20" value="-45" style="width:100%;accent-color:var(--red)">
            <div class="row" style="margin-top:8px"><button class="btn" id="al-split">DÉTECTER</button></div><div class="list" id="al-segs" style="margin-top:8px"></div></div>
        </div>`;

      const dur = () => (buf ? buf.duration : 0);
      const sel = () => ({ a: +$("#al-a").value / 1000 * dur(), b: Math.max(+$("#al-b").value / 1000 * dur(), +$("#al-a").value / 1000 * dur() + 0.01) });
      function draw(play) {
        const c = $("#al-wave"), W = c.width = c.clientWidth * (window.devicePixelRatio || 1), H = c.height = 130 * (window.devicePixelRatio || 1), x = c.getContext("2d");
        x.clearRect(0, 0, W, H);
        if (!buf) return;
        const d = buf.getChannelData(0), step = Math.max(1, Math.floor(d.length / W));
        const s = sel();
        x.fillStyle = "rgba(255,255,255,.07)"; x.fillRect(s.a / dur() * W, 0, (s.b - s.a) / dur() * W, H);
        x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--red2") || "#ff5470";
        for (let i = 0; i < W; i++) { let mx = 0; for (let j = 0; j < step; j += Math.ceil(step / 24)) { const a = Math.abs(d[i * step + j] || 0); if (a > mx) mx = a; } const h = Math.max(1, mx * H * 0.92); x.fillRect(i, (H - h) / 2, 1, h); }
        segs.forEach((g) => { x.fillStyle = "rgba(26,207,214,.25)"; x.fillRect(g.a / dur() * W, 0, (g.b - g.a) / dur() * W, H); });
        if (play != null) { x.fillStyle = "#fff"; x.fillRect(play / dur() * W - 1, 0, 2, H); }
      }
      const labels = () => { const s = sel(); $("#al-av").textContent = fmt(s.a); $("#al-bv").textContent = fmt(s.b); $("#al-gv").textContent = $("#al-g").value + " dB"; $("#al-fiv").textContent = ($("#al-fi").value / 10).toFixed(1) + " s"; $("#al-fov").textContent = ($("#al-fo").value / 10).toFixed(1) + " s"; $("#al-tv").textContent = "−" + Math.abs($("#al-t").value) + " dB"; };
      ["#al-a", "#al-b", "#al-g", "#al-fi", "#al-fo", "#al-t"].forEach((q) => ($(q).oninput = () => { labels(); draw(); }));

      async function load(file) {
        $("#al-info").textContent = "Lecture de " + file.name + "…";
        try {
          ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
          buf = await ctx.decodeAudioData((await A.read(file)).buffer);
          name = file.name.replace(/\.[^.]+$/, "");
          $("#al-main").hidden = false; segs = []; $("#al-segs").innerHTML = ""; $("#al-sn").textContent = "";
          $("#al-a").value = 0; $("#al-b").value = 1000;
          $("#al-info").textContent = `${file.name} · ${fmt(buf.duration)} · ${buf.numberOfChannels === 1 ? "mono" : "stéréo"} · ${buf.sampleRate} Hz`;
          labels(); draw();
        } catch (e) { $("#al-info").textContent = "✕ Lecture impossible : " + (e && e.message ? e.message : "format non pris en charge par ce téléphone"); }
      }
      $("#al-pick").onclick = async () => { const f = (await A.pick({ accept: "audio/*,video/*" }))[0]; if (f) load(f); };

      const stop = () => { if (src) { try { src.stop(); } catch (e) { /* déjà arrêté */ } src = null; } cancelAnimationFrame(raf); draw(); };
      function playRange(a, b) {
        stop(); ctx.resume && ctx.resume();
        src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
        src.start(0, a, b - a); startAt = ctx.currentTime - a;
        const tick = () => { const t = ctx.currentTime - startAt; if (t >= b || !src) return stop(); draw(t); raf = requestAnimationFrame(tick); };
        raf = requestAnimationFrame(tick); src.onended = () => { if (src) stop(); };
      }
      $("#al-play").onclick = () => { if (buf) { const s = sel(); playRange(s.a, s.b); } };
      $("#al-stop").onclick = stop;

      const render = (a, b) => {
        const r = buf.sampleRate, i0 = Math.floor(a * r), i1 = Math.min(buf.length, Math.floor(b * r));
        let chans = []; for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c).subarray(i0, i1));
        if ($("#al-mono").checked && chans.length > 1) { const m = new Float32Array(chans[0].length); chans.forEach((c) => { for (let i = 0; i < m.length; i++) m[i] += c[i] / chans.length; }); chans = [m]; }
        return process(chans, r, { gain: +$("#al-g").value, normalize: $("#al-norm").checked, fadeIn: $("#al-fi").value / 10, fadeOut: $("#al-fo").value / 10 });
      };
      $("#al-save").onclick = () => { if (!buf) return; const s = sel(); A.save(name + "_edit.wav", "audio/wav", wav(render(s.a, s.b), buf.sampleRate), "downloads"); };

      $("#al-split").onclick = () => {
        if (!buf) return;
        const chans = []; for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
        segs = split(chans, buf.sampleRate, +$("#al-t").value, 0.25, 0.1);
        $("#al-sn").textContent = segs.length + " son" + (segs.length > 1 ? "s" : "");
        $("#al-segs").innerHTML = segs.length ? segs.map((g, i) => `<div class="it"><span class="n">Son ${i + 1}<small>${fmt(g.a)} → ${fmt(g.b)} · ${(g.b - g.a).toFixed(2)} s</small></span><button class="mini" data-p="${i}">▶</button><button class="mini" data-s="${i}">WAV</button></div>`).join("") : '<p class="muted">Aucun son détecté : monte le seuil.</p>';
        draw();
      };
      $("#al-segs").onclick = (e) => {
        const p = e.target.closest("[data-p]"), s = e.target.closest("[data-s]");
        if (p) { const g = segs[+p.dataset.p]; playRange(g.a, g.b); }
        if (s) { const g = segs[+s.dataset.s]; A.save(`${name}_son${+s.dataset.s + 1}.wav`, "audio/wav", wav(render(g.a, g.b), buf.sampleRate), "downloads"); }
      };
      el._api = { load, get buf() { return buf; }, render };
    },
  });
})();
