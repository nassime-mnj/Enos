"use strict";
// CINEPULSE MOBILE : montage tactile autonome (moniteur, soundboard, timeline multi-pistes avec magnétisme). Aucun serveur, aucun FFmpeg :
// les médias restent dans la mémoire de la page (projet de la session) ; lecture audio planifiée à l'échantillon près par WebAudio.
// Même logique que CinePulse/ sur PC (snap, zoom à la milliseconde, rognage), en événements « pointer » pour le doigt.
(() => {
  const E = window.ENOS;
  const HEAD = 44, SNAP_PX = 14, MIN_PPS = 2, MAX_PPS = 40000, MIN_DUR = 0.01;
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
      const S = { assets: [], clips: [], markers: [], ph: 0, pps: 80, snap: true, sel: null, playing: false, fps: 25 };
      let ctx = null, sources = [], t0 = 0, c0 = 0, raf = 0, gen = 0;
      const $ = (s) => el.querySelector(s);
      const uid = () => Math.random().toString(36).slice(2, 9);
      const end = (c) => c.start + c.dur;
      const pEnd = () => S.clips.reduce((m, c) => Math.max(m, end(c)), 0);
      const asset = (id) => S.assets.find((a) => a.id === id);
      const overlaps = (tr, s, e, ex) => S.clips.some((c) => c.id !== ex && c.track === tr && c.start < e - 1e-6 && end(c) > s + 1e-6);

      el.innerHTML = `<div class="cp">
        <div class="card cp-mon"><div class="cp-screen"><video playsinline hidden></video><span class="cp-empty">Aucun plan vidéo sous le curseur</span></div>
          <div class="cp-tr"><button class="btn" data-a="start">⏮</button><button class="btn" data-a="back">◀▏</button><button class="btn pri" data-a="play">▶</button><button class="btn" data-a="fwd">▕▶</button><b class="cp-tc">00:00:00:00</b></div></div>
        <div class="card"><h3>Soundboard<span class="sp"><button class="mini" id="cp-imp">+ IMPORTER</button></span></h3>
          <div class="cp-pads"></div><p class="muted" style="font-size:13px;margin-top:8px">Glisse ⠿ sur une piste, ou touche ＋ pour poser le média au curseur. ▶ pour pré-écouter.</p></div>
        <div class="card cp-tlc"><div class="cp-bar"><button class="mini on" id="cp-snap">🧲 Magnétisme</button><button class="mini" id="cp-split">✂ Couper</button><button class="mini" id="cp-del">🗑 Suppr.</button><button class="mini" id="cp-mark">📍 Repère</button></div>
          <div class="cp-bar"><button class="mini" id="cp-zo">−</button><input type="range" id="cp-zoom" min="0" max="1000" aria-label="Zoom"><button class="mini" id="cp-zi">+</button><button class="mini" id="cp-fit">Ajuster</button><span class="muted" id="cp-sc"></span></div>
          <div class="cp-scroll"><div class="cp-content"><div class="cp-rrow"><div class="cp-corner"></div><canvas class="cp-ruler"></canvas></div>
            ${TRACKS.map(([id, ty]) => `<div class="cp-row ${ty}"><div class="cp-head">${id}</div><div class="cp-lane" data-t="${id}"></div></div>`).join("")}
            <div class="cp-ov"><div class="cp-guide"></div><div class="cp-ph"></div></div></div></div>
          <div class="cp-tip" hidden></div></div></div>`;
      const video = $("video"), scroller = $(".cp-scroll"), content = $(".cp-content"), ruler = $(".cp-ruler"), ph = $(".cp-ph"), guide = $(".cp-guide"), tip = $(".cp-tip");
      const lanes = {};
      el.querySelectorAll(".cp-lane").forEach((l) => (lanes[l.dataset.t] = l));
      const typeOf = (id) => TRACKS.find((t) => t[0] === id)[1];
      const viewW = () => Math.max(1, scroller.clientWidth - HEAD);

      // ------------------------------------------------------------ audio
      const ac = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());
      const buffer = (a) => (a.buf ??= a.file.arrayBuffer().then((b) => ac().decodeAudioData(b)).catch(() => null));
      async function importFiles() {
        for (const f of await A.pick({ accept: "audio/*,video/*", multiple: true })) {
          const kind = f.type.startsWith("video") ? "video" : "audio", url = URL.createObjectURL(f);
          const dur = await new Promise((res) => { const m = document.createElement(kind === "video" ? "video" : "audio"); m.preload = "metadata"; m.onloadedmetadata = () => res(isFinite(m.duration) ? m.duration : 0); m.onerror = () => res(0); m.src = url; });
          if (!dur) { A.toast("Format illisible : " + f.name, "warn"); continue; }
          const a = { id: uid(), name: f.name, kind, url, file: f, dur: r3(dur), peaks: null };
          S.assets.push(a); pads();
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
          const d = A.h(`<div class="cp-pad ${a.kind}${pvId === a.id ? " on" : ""}"><span class="cp-grip" title="Glisser vers la timeline">⠿</span><button class="cp-pp">${pvId === a.id ? "■" : "▶"}</button><div class="cp-nm"></div><canvas width="160" height="28"></canvas><button class="cp-add" title="Poser au curseur">＋</button></div>`);
          d.querySelector(".cp-nm").textContent = a.name;
          wave(d.querySelector("canvas"), a, 0, 1, "rgba(47,191,166,.9)");
          d.querySelector(".cp-pp").onclick = () => preview(a);
          d.querySelector(".cp-add").onclick = () => addAtPlayhead(a);
          d.querySelector(".cp-grip").onpointerdown = (e) => padDrag(e, a);
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
        cl.forEach((c, i) => { if (!bufs[i]) return; const s = a.createBufferSource(); s.buffer = bufs[i]; s.connect(a.destination); const k = Math.max(0, t0 - c.start); s.start(c0 + Math.max(0, c.start - t0), c.in + k, c.dur - k); sources.push(s); });
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
        $(".cp-tc").textContent = tc(S.ph, S.fps);
        let c = null;
        for (const [id, ty] of TRACKS) { if (ty !== "video") continue; c = S.clips.find((x) => x.track === id && S.ph >= x.start && S.ph < end(x)); if (c) break; }
        const a = c && asset(c.asset);
        if (!a) { if (!video.paused) video.pause(); video.hidden = true; $(".cp-empty").hidden = false; return; }
        video.hidden = false; $(".cp-empty").hidden = true;
        if (video.dataset.src !== a.url) { video.dataset.src = a.url; video.src = a.url; }
        const target = c.in + S.ph - c.start;
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
          if (a.kind === "audio") { const cv = d.querySelector("canvas"); cv.width = clamp(Math.ceil(c.dur * S.pps), 1, 1500); cv.height = 44; wave(cv, a, c.in / a.dur, (c.in + c.dur) / a.dur, "rgba(255,255,255,.8)"); }
        });
      }
      function changed() { layout(); renderClips(); drawRuler(); syncVideo(); restart(); }
      function addClip(a, track, start) { const c = { id: uid(), asset: a.id, track, start, in: 0, dur: a.dur }; S.clips.push(c); S.sel = c.id; changed(); }
      function addAtPlayhead(a) {
        const cands = TRACKS.filter(([, ty]) => ty === a.kind).map(([id]) => id), s = S.ph;
        const tr = cands.find((id) => !overlaps(id, s, s + a.dur));
        if (!tr) return A.toast("Aucune piste libre à cet endroit.", "warn");
        addClip(a, tr, s);
      }
      function laneAt(x, y, kind) {
        for (const [id, ty] of TRACKS) { if (ty !== kind) continue; const r = lanes[id].getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y < r.bottom) return id; }
        return null;
      }

      scroller.addEventListener("pointerdown", (e) => {
        const d = e.target.closest(".cp-clip");
        if (!d) { if (e.target.closest(".cp-lane")) { S.sel = null; renderSel(); } return; }
        const c = S.clips.find((x) => x.id === d.dataset.id), a = asset(c.asset);
        S.sel = c.id; renderSel();
        const mode = e.target.classList.contains("l") ? "L" : e.target.classList.contains("r") ? "R" : "M";
        const o = { ...c }, x0 = e.clientX, top0 = lanes[c.track].getBoundingClientRect().top, tg = targets(c.id);
        let cur = { ...o }, bad = false;
        d.setPointerCapture(e.pointerId); d.classList.add("drag");
        const edge = (t) => { const s = S.snap ? snapTo([t], tg) : null; return { t: s ? t + s.d : t, sn: s }; };
        const move = (ev) => {
          const dx = (ev.clientX - x0) / S.pps; let sn = null;
          if (mode === "M") { const r = place(o.start + dx, o.dur, c.id); sn = r.sn; cur = { ...o, start: r.start, track: laneAt(ev.clientX, ev.clientY, a.kind) || cur.track }; }
          else if (mode === "L") { const r = edge(o.start + dx); sn = r.sn; const s = r3(clamp(r.t, o.start - o.in, o.start + o.dur - MIN_DUR)); cur = { ...o, start: s, in: r3(o.in + s - o.start), dur: r3(o.dur - (s - o.start)) }; }
          else { const r = edge(o.start + o.dur + dx); sn = r.sn; cur = { ...o, dur: r3(clamp(r.t, o.start + MIN_DUR, o.start + a.dur - o.in) - o.start) }; }
          bad = overlaps(cur.track, cur.start, cur.start + cur.dur, c.id);
          d.style.left = cur.start * S.pps + "px"; d.style.width = Math.max(3, cur.dur * S.pps) + "px";
          d.style.transform = `translateY(${lanes[cur.track].getBoundingClientRect().top - top0}px)`; d.classList.toggle("bad", bad);
          showGuide(sn); showTip(`${ms(cur.start)} → ${ms(cur.start + cur.dur)}${sn ? "  🧲 " + sn.x.l : ""}`);
        };
        const up = () => {
          d.removeEventListener("pointermove", move); d.removeEventListener("pointerup", up); d.removeEventListener("pointercancel", up);
          showGuide(null); showTip("");
          if (!bad) Object.assign(c, { start: cur.start, in: cur.in, dur: cur.dur, track: cur.track });
          if (bad || cur.start !== o.start || cur.dur !== o.dur || cur.track !== o.track) changed(); else d.classList.remove("drag");
        };
        d.addEventListener("pointermove", move); d.addEventListener("pointerup", up); d.addEventListener("pointercancel", up);
      });
      const renderSel = () => el.querySelectorAll(".cp-clip").forEach((d) => d.classList.toggle("sel", d.dataset.id === S.sel));

      // glisser un média de la soundboard (poignée ⠿) vers une piste
      function padDrag(e, a) {
        e.preventDefault(); const grip = e.currentTarget; grip.setPointerCapture(e.pointerId);
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
      $(".cp-tr").onclick = (e) => { const a = e.target.closest("button")?.dataset.a; if (a) act[a](); };
      $("#cp-imp").onclick = importFiles;
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
        S.clips.push({ ...c, id: uid(), start: S.ph, in: r3(c.in + S.ph - c.start), dur: r3(end(c) - S.ph) }); c.dur = r3(S.ph - c.start); changed();
      };
      layout(); drawRuler(); pads(); updatePh(true);
    },
  });
})();
