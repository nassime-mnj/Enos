"use strict";
// CINEPULSE MOBILE : montage tactile autonome (moniteur, soundboard, timeline multi-pistes avec magnétisme). Aucun serveur, aucun FFmpeg :
// les médias restent dans la mémoire de la page (projet de la session) ; lecture audio planifiée à l'échantillon près par WebAudio.
// Même logique que CinePulse/ sur PC (snap, zoom à la milliseconde, rognage), en événements « pointer » pour le doigt.
(() => {
  const E = window.ENOS;
  const HEAD = 48, SNAP_PX = 14, MIN_PPS = 2, MAX_PPS = 40000, MIN_DUR = 0.01;
  const TRACKS = [["V2", "video"], ["V1", "video"], ["A1", "audio"], ["A2", "audio"], ["A3", "audio"]];
  const STEPS = [[0.001, 5], [0.002, 4], [0.005, 5], [0.01, 5], [0.02, 4], [0.05, 5], [0.1, 5], [0.2, 4], [0.5, 5], [1, 5], [2, 4], [5, 5], [10, 5], [30, 6], [60, 6], [300, 5]];
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const p2 = (n) => String(n).padStart(2, "0");
  const tc = (t, f) => { const n = Math.round(t * f), s = Math.floor(n / f); return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}:${p2(n % f)}`; };
  const ms = (t) => { const m = Math.round(t * 1000); return `${Math.floor(m / 60000)}:${p2(Math.floor(m / 1000) % 60)}.${String(m % 1000).padStart(3, "0")}`; };

  E.suite.register({
    id: "cinepulse", group: "pro", title: "CinePulse", sub: "Montage · Soundboard · Timeline",
    icon: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M7 4v5M12 4v5M17 4v5"/>',
    build(el, A) {
      const S = { assets: [], clips: [], markers: [], ph: 0, pps: 80, snap: true, sel: null, playing: false, fps: 25, track: "A1" };
      let dragging = false;
      let ctx = null, sources = [], t0 = 0, c0 = 0, raf = 0, gen = 0;
      const $ = (s) => el.querySelector(s);
      const uid = () => Math.random().toString(36).slice(2, 9);
      const end = (c) => c.start + c.dur;
      const pEnd = () => S.clips.reduce((m, c) => Math.max(m, end(c)), 0);
      const asset = (id) => S.assets.find((a) => a.id === id);
      const FX = E.cpfx, spd = (c) => c.speed || 1, fxOf = (c) => FX.norm(c.fx), srcLen = (c) => c.dur * spd(c);       // srcLen : durée de média consommée par le clip
      let exportDest = null;                                                                                             // pendant l'export : le son part vers le fichier, pas vers les haut-parleurs
      const outNode = () => exportDest || ac().destination;
      const overlaps = (tr, s, e, ex) => S.clips.some((c) => c.id !== ex && c.track === tr && c.start < e - 1e-6 && end(c) > s + 1e-6);

      el.innerHTML = `<div class="cp">
        <div class="card cp-mon"><div class="cp-screen"><video playsinline hidden></video><div class="cp-vig"></div><span class="cp-spd" hidden></span><div class="cp-empty"><span>Aucun plan vidéo sous le curseur</span><button class="cpb big" id="cp-impv">📥 Importer une vidéo</button><button class="cpb big" id="cp-impa">🎵 Importer un son</button></div><b class="cp-tc cp-tcv">00:00:00:00</b></div></div>
        <div class="card cp-tlc"><div class="cp-bar cp-top"><button class="cpb" id="cp-zo" aria-label="Zoom arrière">−</button><input type="range" id="cp-zoom" min="0" max="1000" aria-label="Zoom"><button class="cpb" id="cp-zi" aria-label="Zoom avant">+</button><button class="cpb wide" id="cp-imp2">📥 Importer</button><button class="cpb wide" id="cp-fit">Ajuster</button><span class="muted" id="cp-sc"></span></div>
          <div class="cp-scroll"><div class="cp-content"><div class="cp-rrow"><div class="cp-corner"></div><canvas class="cp-ruler"></canvas></div>
            ${TRACKS.map(([id, ty]) => `<div class="cp-row ${ty}"><div class="cp-head" data-t="${id}" role="button" aria-label="Piste ${id}">${id}</div><div class="cp-lane" data-t="${id}"></div></div>`).join("")}
            <div class="cp-ov"><div class="cp-guide"></div><div class="cp-ph"></div></div></div></div>
          <div class="cp-tip" hidden></div>
          <div class="cp-clipbar" hidden><button class="cpb" id="cp-nl" aria-label="Reculer d'une image">◀</button><button class="cpb" id="cp-nr" aria-label="Avancer d'une image">▶</button><button class="cpb wide" id="cp-ts" title="Début du clip au curseur">⇤ Début</button><button class="cpb wide" id="cp-te" title="Fin du clip au curseur">Fin ⇥</button><button class="cpb" id="cp-del" aria-label="Supprimer le clip">🗑</button></div></div>
        <div class="card cp-insp-hint"><b>⚡ ACCÉLÉRATEUR</b><span>Importe une vidéo (📥), puis touche son clip dans la timeline : vitesse de 0,25× à 8×, filtres et volume apparaissent ici.</span></div>
        <div class="card cp-insp" hidden>
          <div class="cp-tabs"><button data-p="speed" class="on">⚡ VITESSE</button><button data-p="fx">🎨 FILTRES</button><button data-p="aud">🔊 AUDIO</button></div>
          <div class="cp-panel" data-p="speed"></div><div class="cp-panel" data-p="fx" hidden></div><div class="cp-panel" data-p="aud" hidden></div>
        </div>
        <div class="card cp-exp"><h3>Exporter<span class="sp" id="cp-expinfo"></span></h3>
          <div class="row"><select id="cp-expres" class="sel"><option value="1280x720">720p · 1280×720</option><option value="854x480">480p · rapide</option><option value="1920x1080">1080p · lent</option></select><button class="btn pri" id="cp-export">⬆ EXPORTER LA VIDÉO</button></div>
          <div class="cp-prog" hidden><i></i></div>
          <p class="muted" style="font-size:12.5px;margin-top:8px">La vidéo est montée sur le téléphone avec tous tes effets, vitesses et volumes, puis enregistrée (WebM). Garde l'écran allumé pendant l'export.</p></div>
        <div class="card"><h3>Soundboard<span class="sp"><button class="cpb wide" id="cp-imp">+ Importer</button></span></h3>
          <div class="cp-pads"></div><p class="muted" style="font-size:13px;margin-top:8px">Maintiens ⠿ et glisse sur une piste, ou touche ＋ pour poser au curseur (piste active : touche son nom).</p></div>
        <div class="cp-dock"><div class="cp-dg"><button class="cpb" data-a="start" aria-label="Début">⏮</button><button class="cpb" data-a="back" aria-label="Image précédente">◀▏</button><button class="cpb play" data-a="play" aria-label="Lecture">▶</button><button class="cpb" data-a="fwd" aria-label="Image suivante">▕▶</button></div>
          <b class="cp-tc">00:00:00:00</b>
          <div class="cp-dg"><button class="cpb on" id="cp-snap" aria-label="Magnétisme">🧲</button><button class="cpb" id="cp-split" aria-label="Couper au curseur">✂</button><button class="cpb" id="cp-mark" aria-label="Repère">📍</button></div></div></div>`;
      const video = $("video"), scroller = $(".cp-scroll"), content = $(".cp-content"), ruler = $(".cp-ruler"), ph = $(".cp-ph"), guide = $(".cp-guide"), tip = $(".cp-tip");
      const lanes = {};
      el.querySelectorAll(".cp-lane").forEach((l) => (lanes[l.dataset.t] = l));
      const typeOf = (id) => TRACKS.find((t) => t[0] === id)[1];
      const viewW = () => Math.max(1, scroller.clientWidth - HEAD);

      // ------------------------------------------------------------ audio
      const ac = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());
      const buffer = (a) => (a.buf ??= a.file.arrayBuffer().then((b) => ac().decodeAudioData(b)).catch(() => null));
      async function importFiles() { return importList(await A.pick({ accept: "audio/*,video/*", multiple: true })); }
      // boutons bien visibles : une vidéo importée est posée tout de suite sur la timeline (au curseur) et sélectionnée -> l'accélérateur ⚡ s'affiche aussitôt
      async function importVideo() { await importList(await A.pick({ accept: "video/*", multiple: false }), true); }
      async function importAll() { await importList(await A.pick({ accept: "audio/*,video/*", multiple: true }), true); }
      async function importList(files, auto) {
        for (const f of files) {
          const kind = f.type.startsWith("video") ? "video" : "audio", url = URL.createObjectURL(f);
          const dur = await new Promise((res) => { const m = document.createElement(kind === "video" ? "video" : "audio"); m.preload = "metadata"; m.onloadedmetadata = () => { if (isFinite(m.duration)) return res(m.duration); m.ondurationchange = () => { if (isFinite(m.duration)) res(m.duration); }; m.currentTime = 1e7; setTimeout(() => res(isFinite(m.duration) ? m.duration : 0), 4000); };   /* WebM enregistré par le téléphone : durée inconnue tant qu'on n'a pas été à la fin */ m.onerror = () => res(0); m.src = url; });
          if (!dur) { A.toast("Format illisible : " + f.name, "warn"); continue; }
          const a = { id: uid(), name: f.name, kind, url, file: f, dur: r3(dur), peaks: null };
          S.assets.push(a); pads();
          if (auto && kind === "video") { addAtPlayhead(a); const ins = $(".cp-insp"); if (ins && !ins.hidden) ins.scrollIntoView({ behavior: "smooth", block: "nearest" }); A.toast("Vidéo ajoutée : règle l'accélérateur ⚡ ci-dessous.", "ok"); }
          buffer(a).then((b) => { if (b) { a.peaks = peaksOf(b); pads(); renderClips(); } });
        }
      }
      function peaksOf(b) {
        const ch = b.getChannelData(0), n = Math.min(20000, Math.max(300, Math.ceil(b.duration * 200))), step = Math.max(1, Math.floor(ch.length / n)), out = [];
        for (let i = 0; i < ch.length; i += step) { let m = 0; for (let j = i, e = Math.min(i + step, ch.length); j < e; j += 2) { const v = Math.abs(ch[j]); if (v > m) m = v; } out.push(m); }
        return out;
      }
      function wave(cv, a, f0, f1, color) {
        const g = cv.getContext("2d"), w = cv.width, h = cv.height; g.clearRect(0, 0, w, h);
        if (!a.peaks) return;
        g.fillStyle = color; const n = a.peaks.length, i0 = f0 * n, sp = (f1 - f0) * n;
        for (let x = 0; x < w; x++) { const s = Math.floor(i0 + sp * x / w), e = Math.max(s + 1, Math.floor(i0 + sp * (x + 1) / w)); let m = 0; for (let i = s; i < e && i < n; i++) if (a.peaks[i] > m) m = a.peaks[i]; const amp = Math.max(1, m * h * 0.46); g.fillRect(x, h / 2 - amp, 1, amp * 2); }
      }

      let pv = null, pvId = null;
      function preview(a) {
        if (pv) { pv.pause(); pv = null; }
        if (pvId === a.id) { pvId = null; return pads(); }
        pv = new Audio(a.url); pvId = a.id; pv.onended = () => { pvId = null; pads(); }; pv.play().catch(() => {}); pads();
      }
      function pads() {
        const box = $(".cp-pads");
        if (!S.assets.length) { box.innerHTML = '<p class="muted">Aucun média. Touche « + IMPORTER » (sons, vidéos).</p>'; return; }
        box.replaceChildren(...S.assets.map((a) => {
          const d = A.h(`<div class="cp-pad ${a.kind}${pvId === a.id ? " on" : ""}"><span class="cp-grip" role="button" aria-label="Glisser vers la timeline">⠿</span><button class="cpb cp-pp" aria-label="Pré-écouter">${pvId === a.id ? "■" : "▶"}</button><div class="cp-pm"><div class="cp-nm"></div><canvas width="160" height="28"></canvas></div><button class="cpb cp-add" aria-label="Poser au curseur">＋</button></div>`);
          d.querySelector(".cp-nm").textContent = a.name;
          wave(d.querySelector("canvas"), a, 0, 1, "rgba(47,191,166,.9)");
          d.querySelector(".cp-pp").onclick = () => preview(a);
          d.querySelector(".cp-add").onclick = () => addAtPlayhead(a);
          const g = d.querySelector(".cp-grip");
          g.onpointerdown = (e) => padDrag(e, a, g);                 // touch-action:none sur la poignée : le doigt ne fait pas défiler
          return d;
        }));
      }

      // ------------------------------------------------------------ lecture
      async function play() {
        const my = ++gen, e = pEnd(); if (!e) return;
        const a = ac(); await a.resume();
        if (S.ph >= e - 0.001) S.ph = 0;
        const cl = S.clips.filter((c) => asset(c.asset)?.kind === "audio" && end(c) > S.ph), bufs = await Promise.all(cl.map((c) => buffer(asset(c.asset))));
        if (my !== gen) return;
        t0 = S.ph; c0 = a.currentTime + 0.08; sources = [];
        cl.forEach((c, i) => { if (!bufs[i]) return; const s = a.createBufferSource(), g = a.createGain(), k = Math.max(0, t0 - c.start); s.buffer = bufs[i]; s.playbackRate.value = spd(c); g.gain.value = (c.vol ?? 100) / 100; s.connect(g); g.connect(outNode()); s.start(c0 + Math.max(0, c.start - t0), c.in + k * spd(c)); s.stop(c0 + end(c) - t0); sources.push(s); });
        S.playing = true; $("[data-a=play]").textContent = "⏸"; loop();
      }
      function loop() {
        if (!S.playing) return;
        const t = Math.max(t0, t0 + ctx.currentTime - c0);
        if (t >= pEnd()) { pause(); setPh(pEnd(), false); return; }
        setPh(t, false); raf = requestAnimationFrame(loop);
      }
      function pause() {
        gen++; cancelAnimationFrame(raf); sources.forEach((s) => { try { s.stop(); } catch (e) { /* arrêté */ } }); sources = [];
        S.playing = false; $("[data-a=play]").textContent = "▶"; syncVideo();
      }
      const restart = () => { if (S.playing) { pause(); play(); } };
      function setPh(t, user = true) { S.ph = Math.max(0, r3(t)); updatePh(); syncVideo(); if (user) restart(); }
      const step = (n) => { pause(); setPh(Math.max(0, (Math.round(S.ph * S.fps) + n) / S.fps)); };

      function syncVideo() {
        el.querySelectorAll(".cp-tc").forEach((x) => (x.textContent = tc(S.ph, S.fps)));
        let c = null;
        for (const [id, ty] of TRACKS) { if (ty !== "video") continue; c = S.clips.find((x) => x.track === id && S.ph >= x.start && S.ph < end(x)); if (c) break; }
        const a = c && asset(c.asset);
        if (!a) { if (!video.paused) video.pause(); video.hidden = true; $(".cp-empty").hidden = false; $(".cp-vig").style.opacity = 0; $(".cp-spd").hidden = true; return; }
        video.hidden = false; $(".cp-empty").hidden = true;
        video.style.filter = FX.css(c.fx); video.playbackRate = spd(c);
        const vg = FX.vignette(c.fx); $(".cp-vig").style.opacity = vg ? 1 : 0; if (vg) $(".cp-vig").style.background = FX.vignetteCss(vg);
        const sb = $(".cp-spd"); sb.hidden = spd(c) === 1; sb.textContent = spd(c) + "×";
        if (video.dataset.src !== a.url) { video.dataset.src = a.url; video.src = a.url; }
        const target = c.in + (S.ph - c.start) * spd(c);
        if (S.playing) { if (video.paused) { video.currentTime = target; video.play().catch(() => {}); } else if (Math.abs(video.currentTime - target) > 0.25) video.currentTime = target; }
        else { if (!video.paused) video.pause(); if (Math.abs(video.currentTime - target) > 0.001) video.currentTime = target; }
      }

      // ------------------------------------------------------------ géométrie, zoom, règle
      const s2p = (v) => MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, v / 1000), p2s = (p) => Math.log(p / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS) * 1000;
      function layout() {
        content.style.width = `${HEAD + Math.max(pEnd() + 20, viewW() / S.pps + 5, 40) * S.pps}px`;
        $("#cp-zoom").value = p2s(S.pps); $("#cp-sc").textContent = S.pps >= 1000 ? `${(S.pps / 1000).toFixed(1)} px/ms` : `${Math.round(S.pps)} px/s`;
      }
      function setZoom(p, anchor) {
        p = clamp(p, MIN_PPS, MAX_PPS); const t = (scroller.scrollLeft + anchor) / S.pps; S.pps = p; layout();
        scroller.scrollLeft = t * p - anchor; renderClips(); drawRuler(); updatePh(true);
      }
      const fit = () => { setZoom(viewW() / Math.max(pEnd() * 1.1, 5), 0); scroller.scrollLeft = 0; };
      function drawRuler() {
        const w = viewW(), h = 24, d = window.devicePixelRatio || 1;
        if (ruler.width !== Math.round(w * d)) { ruler.width = Math.round(w * d); ruler.height = h * d; ruler.style.width = w + "px"; ruler.style.height = h + "px"; }
        const g = ruler.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
        const t0_ = scroller.scrollLeft / S.pps, t1 = t0_ + w / S.pps, [stp, sub] = STEPS.find(([x]) => x * S.pps >= 80) || STEPS[STEPS.length - 1], mn = stp / sub;
        g.font = "10px system-ui"; g.textBaseline = "top";
        for (let k = Math.floor(t0_ / mn); k * mn <= t1 + mn; k++) {
          const t = k * mn, x = Math.round((t - t0_) * S.pps) + 0.5, major = k % sub === 0;
          g.strokeStyle = major ? "#777" : "#3a3a42"; g.beginPath(); g.moveTo(x, major ? 10 : 17); g.lineTo(x, h); g.stroke();
          if (major) { g.fillStyle = "#a0a0aa"; const m = Math.floor(t / 60), s = t - m * 60; g.fillText(stp >= 1 ? `${m}:${p2(Math.round(s))}` : (m ? m + ":" : "") + s.toFixed(stp >= 0.1 ? 1 : stp >= 0.01 ? 2 : 3), x + 3, 1); }
        }
        g.fillStyle = "#f5b942";
        S.markers.forEach((m) => { const x = (m.t - t0_) * S.pps; if (x > -6 && x < w + 6) { g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 8); g.fill(); } });
      }
      function updatePh(noScroll) {
        const x = HEAD + S.ph * S.pps; ph.style.transform = `translateX(${x}px)`;
        if (S.playing && !noScroll && x > scroller.scrollLeft + scroller.clientWidth - 40) scroller.scrollLeft = x - HEAD - 30;
      }

      // ------------------------------------------------------------ magnétisme
      function targets(ex) {
        const t = [{ t: 0, l: "Début" }, { t: S.ph, l: "Curseur" }, ...S.markers.map((m) => ({ t: m.t, l: "Repère" }))];
        S.clips.forEach((c) => { if (c.id !== ex) t.push({ t: c.start, l: "Début de clip" }, { t: end(c), l: "Fin de clip" }); });
        return t;
      }
      function snapTo(edges, tg) {
        const thr = SNAP_PX / S.pps; let best = null;
        edges.forEach((e) => tg.forEach((x) => { const d = x.t - e; if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, x }; }));
        return best;
      }
      function place(raw, dur, ex) {
        let s = Math.max(0, raw), sn = null;
        if (S.snap) { sn = snapTo([s, s + dur], targets(ex)); if (sn) s = Math.max(0, s + sn.d); }
        return { start: r3(s), sn };
      }
      const showGuide = (sn) => { guide.style.display = sn ? "block" : "none"; if (sn) guide.style.left = HEAD + sn.x.t * S.pps + "px"; };
      const showTip = (txt) => { tip.hidden = !txt; tip.textContent = txt || ""; };

      // ------------------------------------------------------------ clips
      function renderClips() {
        Object.values(lanes).forEach((l) => l.replaceChildren());
        S.clips.forEach((c) => {
          const a = asset(c.asset); if (!a) return;
          const d = A.h(`<div class="cp-clip ${a.kind}${c.id === S.sel ? " sel" : ""}" data-id="${c.id}">${a.kind === "audio" ? "<canvas></canvas>" : ""}<span></span><i class="h l"></i><i class="h r"></i></div>`);
          d.style.left = c.start * S.pps + "px"; d.style.width = Math.max(3, c.dur * S.pps) + "px"; d.querySelector("span").textContent = a.name;
          lanes[c.track].append(d);
          if (a.kind === "audio") { const cv = d.querySelector("canvas"); cv.width = clamp(Math.ceil(c.dur * S.pps), 1, 1500); cv.height = 44; wave(cv, a, c.in / a.dur, (c.in + srcLen(c)) / a.dur, "rgba(255,255,255,.8)"); }
        });
      }
      function syncBar() {
        $(".cp-clipbar").hidden = !S.clips.some((c) => c.id === S.sel);
        inspector();
        el.querySelectorAll(".cp-head").forEach((h) => h.classList.toggle("act", h.dataset.t === S.track));
      }
      function changed() { layout(); renderClips(); drawRuler(); syncVideo(); restart(); syncBar(); }
      function addClip(a, track, start) { const c = { id: uid(), asset: a.id, track, start, in: 0, dur: a.dur, speed: 1, vol: 100, fx: { ...FX.DEFAULT } }; S.clips.push(c); S.sel = c.id; changed(); }
      function addAtPlayhead(a) {
        const cands = TRACKS.filter(([, ty]) => ty === a.kind).map(([id]) => id).sort((x, y) => (y === S.track) - (x === S.track)), s = S.ph;
        const tr = cands.find((id) => !overlaps(id, s, s + a.dur));
        if (!tr) return A.toast("Aucune piste libre à cet endroit.", "warn");
        addClip(a, tr, s);
      }
      function laneAt(x, y, kind) {
        for (const [id, ty] of TRACKS) { if (ty !== kind) continue; const r = lanes[id].getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y < r.bottom) return id; }
        return null;
      }

      // Au doigt, le clip se déplace après un APPUI LONG (sinon le glissement fait défiler la timeline) ; les poignées de rognage (clip sélectionné) et la souris agissent tout de suite.
      function holdThen(e, node, fn) {
        const x = e.clientX, y = e.clientY;
        const clean = () => { node.removeEventListener("pointermove", mv); node.removeEventListener("pointerup", stop); node.removeEventListener("pointercancel", stop); };
        const stop = () => { clearTimeout(t); clean(); };
        const mv = (ev) => { if (Math.hypot(ev.clientX - x, ev.clientY - y) > 9) stop(); };
        const t = setTimeout(() => { clean(); if (E.vibrate) E.vibrate(15); fn(); }, 260);
        node.addEventListener("pointermove", mv); node.addEventListener("pointerup", stop); node.addEventListener("pointercancel", stop);
      }
      scroller.addEventListener("pointerdown", (e) => {
        const d = e.target.closest(".cp-clip");
        if (!d) { if (e.target.closest(".cp-lane")) { S.sel = null; renderSel(); } return; }
        const c = S.clips.find((x) => x.id === d.dataset.id);
        S.sel = c.id; renderSel();
        const mode = e.target.classList.contains("l") ? "L" : e.target.classList.contains("r") ? "R" : "M";
        if (mode === "M" && e.pointerType !== "mouse") holdThen(e, d, () => clipDrag(e, d, c, mode)); else clipDrag(e, d, c, mode);
      });
      scroller.addEventListener("touchmove", (e) => { if (dragging && e.cancelable) e.preventDefault(); }, { passive: false });
      function clipDrag(e, d, c, mode) {
        const a = asset(c.asset);
        const o = { ...c }, x0 = e.clientX, top0 = lanes[c.track].getBoundingClientRect().top, tg = targets(c.id);
        let cur = { ...o }, bad = false;
        try { d.setPointerCapture(e.pointerId); } catch (x) { /* pointeur déjà relâché */ }
        d.classList.add("drag"); dragging = true;
        const edge = (t) => { const s = S.snap ? snapTo([t], tg) : null; return { t: s ? t + s.d : t, sn: s }; };
        const move = (ev) => {
          const dx = (ev.clientX - x0) / S.pps; let sn = null;
          if (mode === "M") { const r = place(o.start + dx, o.dur, c.id); sn = r.sn; cur = { ...o, start: r.start, track: laneAt(ev.clientX, ev.clientY, a.kind) || cur.track }; }
          else if (mode === "L") { const r = edge(o.start + dx); sn = r.sn; const s = r3(clamp(r.t, o.start - o.in / spd(o), o.start + o.dur - MIN_DUR)); cur = { ...o, start: s, in: r3(o.in + (s - o.start) * spd(o)), dur: r3(o.dur - (s - o.start)) }; }
          else { const r = edge(o.start + o.dur + dx); sn = r.sn; cur = { ...o, dur: r3(clamp(r.t, o.start + MIN_DUR, o.start + (a.dur - o.in) / spd(o)) - o.start) }; }
          bad = overlaps(cur.track, cur.start, cur.start + cur.dur, c.id);
          d.style.left = cur.start * S.pps + "px"; d.style.width = Math.max(3, cur.dur * S.pps) + "px";
          d.style.transform = `translateY(${lanes[cur.track].getBoundingClientRect().top - top0}px)`; d.classList.toggle("bad", bad);
          showGuide(sn); showTip(`${ms(cur.start)} → ${ms(cur.start + cur.dur)}${sn ? "  🧲 " + sn.x.l : ""}`);
        };
        const up = () => {
          d.removeEventListener("pointermove", move); d.removeEventListener("pointerup", up); d.removeEventListener("pointercancel", up);
          dragging = false; showGuide(null); showTip("");
          if (!bad) Object.assign(c, { start: cur.start, in: cur.in, dur: cur.dur, track: cur.track });
          if (bad || cur.start !== o.start || cur.dur !== o.dur || cur.track !== o.track) changed(); else d.classList.remove("drag");
        };
        d.addEventListener("pointermove", move); d.addEventListener("pointerup", up); d.addEventListener("pointercancel", up);
      }
      const renderSel = () => { el.querySelectorAll(".cp-clip").forEach((d) => d.classList.toggle("sel", d.dataset.id === S.sel)); syncBar(); };

      // glisser un média de la soundboard (poignée ⠿) vers une piste
      function padDrag(e, a, grip) {
        e.preventDefault(); grip.setPointerCapture(e.pointerId);
        const ghost = A.h('<div class="cp-gp"></div>'); ghost.textContent = a.name; document.body.append(ghost);
        let drop = null, bar = null;
        const move = (ev) => {
          ghost.style.transform = `translate(${ev.clientX + 10}px,${ev.clientY - 36}px)`; bar?.remove(); bar = null;
          const id = laneAt(ev.clientX, ev.clientY, a.kind);
          if (!id) { drop = null; showGuide(null); showTip(""); return; }
          const raw = (ev.clientX - lanes[id].getBoundingClientRect().left) / S.pps, r = place(raw, a.dur, null), bad = overlaps(id, r.start, r.start + a.dur);
          drop = bad ? null : { id, start: r.start };
          bar = A.h(`<div class="cp-clip ghost ${a.kind}${bad ? " bad" : ""}"></div>`); bar.style.left = r.start * S.pps + "px"; bar.style.width = Math.max(3, a.dur * S.pps) + "px"; lanes[id].append(bar);
          showGuide(r.sn); showTip(`${ms(r.start)} → ${ms(r.start + a.dur)}${r.sn ? "  🧲 " + r.sn.x.l : ""}`);
        };
        const up = () => {
          grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up);
          ghost.remove(); bar?.remove(); showGuide(null); showTip("");
          if (drop) addClip(a, drop.id, drop.start);
        };
        grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
        move(e);
      }

      // ------------------------------------------------------------ règle (déplacer le curseur), pincement (zoom)
      ruler.addEventListener("pointerdown", (e) => {
        ruler.setPointerCapture(e.pointerId); const tg = targets(null).filter((x) => x.l !== "Curseur");
        const mv = (ev) => { let t = Math.max(0, (scroller.scrollLeft + ev.clientX - ruler.getBoundingClientRect().left) / S.pps); if (S.snap) { const s = snapTo([t], tg); if (s) t += s.d; } pause(); setPh(t); };
        const up = () => { ruler.removeEventListener("pointermove", mv); ruler.removeEventListener("pointerup", up); };
        ruler.addEventListener("pointermove", mv); ruler.addEventListener("pointerup", up); mv(e);
      });
      let pinch = null;
      scroller.addEventListener("touchstart", (e) => { if (e.touches.length === 2) pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), p: S.pps }; }, { passive: true });
      scroller.addEventListener("touchmove", (e) => {
        if (!pinch || e.touches.length !== 2) return; e.preventDefault();
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        setZoom(pinch.p * d / pinch.d, Math.max(0, cx - scroller.getBoundingClientRect().left - HEAD));
      }, { passive: false });
      scroller.addEventListener("touchend", () => { pinch = null; });
      scroller.addEventListener("wheel", (e) => { if (e.shiftKey) return; e.preventDefault(); setZoom(S.pps * Math.exp(-e.deltaY * 0.0015), Math.max(0, e.clientX - scroller.getBoundingClientRect().left - HEAD)); }, { passive: false });
      scroller.addEventListener("scroll", drawRuler);
      new ResizeObserver(() => { layout(); drawRuler(); }).observe(scroller);

      // ------------------------------------------------------------ commandes
      const act = { start: () => { pause(); setPh(0); }, back: () => step(-1), fwd: () => step(1), play: () => (S.playing ? pause() : play()) };
      $(".cp-dock").addEventListener("click", (e) => { const a = e.target.closest("button")?.dataset.a; if (a) act[a](); });
      el.querySelectorAll(".cp-head").forEach((h) => (h.onclick = () => { S.track = h.dataset.t; syncBar(); }));
      const sel = () => S.clips.find((c) => c.id === S.sel);
      const stepT = () => (S.pps >= 1000 ? 0.001 : 1 / S.fps);
      const nudge = (dir) => { const c = sel(); if (!c) return; const s = Math.max(0, r3(c.start + dir * stepT())); if (overlaps(c.track, s, s + c.dur, c.id)) return A.toast("Collision avec un autre clip.", "warn"); c.start = s; changed(); };
      $("#cp-nl").onclick = () => nudge(-1);
      $("#cp-nr").onclick = () => nudge(1);
      $("#cp-ts").onclick = () => { const c = sel(); if (!c || S.ph <= c.start + MIN_DUR || S.ph >= end(c)) return A.toast("Place le curseur dans le clip.", "warn"); const d = S.ph - c.start; c.in = r3(c.in + d * spd(c)); c.start = S.ph; c.dur = r3(c.dur - d); changed(); };
      $("#cp-te").onclick = () => { const c = sel(); if (!c || S.ph <= c.start + MIN_DUR || S.ph >= end(c)) return A.toast("Place le curseur dans le clip.", "warn"); c.dur = r3(S.ph - c.start); changed(); };
      $("#cp-imp").onclick = importFiles;
      $("#cp-impv").onclick = importVideo; $("#cp-impa").onclick = importAll; $("#cp-imp2").onclick = importAll;
      $("#cp-snap").onclick = (e) => { S.snap = !S.snap; e.currentTarget.classList.toggle("on", S.snap); };
      $("#cp-zi").onclick = () => setZoom(S.pps * 1.6, viewW() / 2);
      $("#cp-zo").onclick = () => setZoom(S.pps / 1.6, viewW() / 2);
      $("#cp-zoom").oninput = (e) => setZoom(s2p(+e.target.value), viewW() / 2);
      $("#cp-fit").onclick = fit;
      $("#cp-del").onclick = () => { if (!S.sel) return; S.clips = S.clips.filter((c) => c.id !== S.sel); S.sel = null; changed(); };
      $("#cp-mark").onclick = () => { const i = S.markers.findIndex((m) => Math.abs(m.t - S.ph) < 0.001); if (i >= 0) S.markers.splice(i, 1); else S.markers.push({ t: S.ph }); drawRuler(); };
      $("#cp-split").onclick = () => {
        const hit = (c) => S.ph > c.start + 0.001 && S.ph < end(c) - 0.001, c = S.clips.find((x) => x.id === S.sel && hit(x)) || S.clips.find(hit);
        if (!c) return A.toast("Place le curseur dans un clip.", "warn");
        S.clips.push({ ...c, fx: { ...c.fx }, id: uid(), start: S.ph, in: r3(c.in + (S.ph - c.start) * spd(c)), dur: r3(end(c) - S.ph) }); c.dur = r3(S.ph - c.start); changed();
      };
      // ------------------------------------------------------------ inspecteur : vitesse, filtres, audio du clip sélectionné
      const slider = (key, label, min, max, step, val, unit) => `<label class="cp-sl"><span>${label}<b data-v="${key}">${val}${unit}</b></span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
      let insTab = "speed", insId = null, insStamp = "";
      function inspector() {
        const c = sel(), box = $(".cp-insp");
        box.hidden = !c;
        const hint = $(".cp-insp-hint"); if (hint) hint.hidden = !!c;
        if (!c) { insId = null; return; }
        const a = asset(c.asset), isV = a.kind === "video";
        if (!isV && insTab === "fx") insTab = "speed";
        const stamp = c.id + "|" + spd(c) + "|" + insTab;
        if (stamp === insStamp && insId === c.id) return;                 // ne reconstruit pas les curseurs pendant qu'on les glisse
        insId = c.id; insStamp = stamp;
        box.querySelectorAll(".cp-tabs button").forEach((b) => { b.classList.toggle("on", b.dataset.p === insTab); b.hidden = b.dataset.p === "fx" && !isV; });
        box.querySelectorAll(".cp-panel").forEach((p) => (p.hidden = p.dataset.p !== insTab));
        const f = fxOf(c);
        $('.cp-panel[data-p="speed"]').innerHTML = `<div class="cp-chips">${FX.SPEEDS.map((v) => `<button class="cp-chip${v === spd(c) ? " on" : ""}" data-sp="${v}">${v}×</button>`).join("")}</div>
          ${slider("speed", "Accélérateur", 0.25, 8, 0.05, spd(c), "×")}<p class="muted cp-note">Le clip dure maintenant ${ms(c.dur)} sur la timeline. Au-dessus de 1× il raccourcit, en dessous il s'allonge (le clip voisin bloque si la place manque).</p>`;
        $('.cp-panel[data-p="fx"]').innerHTML = `<div class="cp-chips">${FX.PRESETS.map(([n], i) => `<button class="cp-chip" data-pr="${i}">${n}</button>`).join("")}</div>
          ${slider("blur", "Flou gaussien", 0, 20, 0.5, f.blur, " px")}${slider("bright", "Luminosité", 40, 180, 1, f.bright, " %")}${slider("contrast", "Contraste", 40, 200, 1, f.contrast, " %")}
          ${slider("sat", "Saturation", 0, 300, 1, f.sat, " %")}${slider("hue", "Teinte", 0, 360, 1, f.hue, "°")}${slider("sepia", "Sépia", 0, 100, 1, f.sepia, " %")}
          ${slider("gray", "Noir & blanc", 0, 100, 1, f.gray, " %")}${slider("invert", "Négatif", 0, 100, 1, f.invert, " %")}${slider("vig", "Vignette", 0, 100, 1, f.vig, " %")}`;
        $('.cp-panel[data-p="aud"]').innerHTML = `${slider("vol", "Volume du clip", 0, 200, 1, c.vol ?? 100, " %")}<p class="muted cp-note">La vitesse change aussi la hauteur du son (comme un disque qu'on accélère).</p>`;
      }
      function setSpeed(c, v) {
        v = clamp(Math.round(v * 100) / 100, 0.25, 8);
        const nd = r3(c.dur * spd(c) / v);
        if (overlaps(c.track, c.start, c.start + nd, c.id)) { A.toast("Pas assez de place sur la piste pour cette vitesse.", "warn"); insStamp = ""; return inspector(); }
        c.speed = v; c.dur = Math.max(MIN_DUR, nd); insStamp = ""; changed();
      }
      $(".cp-insp").addEventListener("click", (e) => {
        const c = sel(); if (!c) return;
        const tab = e.target.closest(".cp-tabs button"), sp = e.target.closest("[data-sp]"), pr = e.target.closest("[data-pr]");
        if (tab) { insTab = tab.dataset.p; insStamp = ""; return inspector(); }
        if (sp) return setSpeed(c, +sp.dataset.sp);
        if (pr) { c.fx = { ...FX.DEFAULT, ...FX.PRESETS[+pr.dataset.pr][1] }; insStamp = ""; inspector(); syncVideo(); }
      });
      $(".cp-insp").addEventListener("input", (e) => {
        const c = sel(), k = e.target.dataset.k; if (!c || !k) return;
        const v = +e.target.value, lab = $(`.cp-insp [data-v="${k}"]`);
        if (k === "speed") { if (lab) lab.textContent = v + "×"; return; }                 // la vitesse s'applique au relâchement (elle change la durée du clip)
        if (k === "vol") { c.vol = v; if (lab) lab.textContent = v + " %"; return; }
        c.fx = { ...fxOf(c), [k]: v }; if (lab) lab.textContent = v + (k === "blur" ? " px" : k === "hue" ? "°" : " %"); syncVideo();
      });
      $(".cp-insp").addEventListener("change", (e) => { const c = sel(); if (c && e.target.dataset.k === "speed") setSpeed(c, +e.target.value); });

      // ------------------------------------------------------------ export : montage rendu en temps réel (canvas + MediaRecorder), avec effets, vitesses et volumes
      let exporting = false, lastExport = null;
      async function exportVideo() {
        if (exporting) return;
        const total = pEnd(); if (!total) return A.toast("La timeline est vide.", "warn");
        if (typeof MediaRecorder === "undefined") return A.toast("L'export vidéo n'est pas disponible sur cet appareil.", "err");
        const [W, H] = $("#cp-expres").value.split("x").map(Number);
        const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
        if (!mime) return A.toast("Aucun format d'export pris en charge.", "err");
        exporting = true; pause(); setPh(0, false);
        const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
        const g = cv.getContext("2d"), a = ac(); await a.resume();
        exportDest = a.createMediaStreamDestination();
        if (!video._src) video._src = a.createMediaElementSource(video);                      // le son des plans vidéo passe aussi par WebAudio (donc dans le fichier)
        try { video._src.disconnect(); } catch (x) { /* pas encore branché */ }
        video._src.connect(exportDest);
        const stream = cv.captureStream(30); exportDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: W >= 1920 ? 10e6 : 5e6 }), chunks = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        const bar = $(".cp-prog"), fill = bar.firstElementChild; bar.hidden = false; $("#cp-export").disabled = true;
        const draw = () => {
          g.filter = "none"; g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
          let c = null;
          for (const [id, ty] of TRACKS) { if (ty !== "video") continue; c = S.clips.find((x) => x.track === id && S.ph >= x.start && S.ph < end(x)); if (c) break; }
          if (c && video.videoWidth) {
            const k = Math.min(W / video.videoWidth, H / video.videoHeight), w = video.videoWidth * k, h = video.videoHeight * k;
            g.filter = FX.css(c.fx, W / Math.max(1, video.clientWidth || 360)); g.drawImage(video, (W - w) / 2, (H - h) / 2, w, h); g.filter = "none";
            const vg = FX.vignette(c.fx);
            if (vg) { const r = Math.hypot(W, H) / 2, gr = g.createRadialGradient(W / 2, H / 2, r * (0.62 - vg * 0.2), W / 2, H / 2, r); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, `rgba(0,0,0,${vg * 0.9})`); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
          }
          fill.style.width = Math.min(100, S.ph / total * 100) + "%";
        };
        const done = new Promise((res) => (rec.onstop = res));
        rec.start(500);
        await play();
        await new Promise((res) => { const tick = () => { draw(); if (S.playing) requestAnimationFrame(tick); else res(); }; tick(); });
        draw(); await new Promise((r) => setTimeout(r, 300));
        rec.stop(); await done;
        try { video._src.disconnect(); video._src.connect(a.destination); } catch (x) { /* ignoré */ }
        exportDest = null; exporting = false; bar.hidden = true; $("#cp-export").disabled = false; fill.style.width = "0";
        const blob = new Blob(chunks, { type: mime.split(";")[0] }), name = `CinePulse_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.${mime.includes("mp4") ? "mp4" : "webm"}`;
        lastExport = blob; $("#cp-expinfo").textContent = `${(blob.size / 1048576).toFixed(1)} Mo`;
        await A.save(name, blob.type, new Uint8Array(await blob.arrayBuffer()), "videos");
      }
      $("#cp-export").onclick = exportVideo;
      el._api = { S, importList, exportVideo, setSpeed: (id, v) => setSpeed(S.clips.find((c) => c.id === id), v), addClip, asset, get lastExport() { return lastExport; } };
      layout(); drawRuler(); pads(); updatePh(true); syncBar();
    },
  });
})();
