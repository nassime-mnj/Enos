"use strict";
// COMPRESSION (téléphone, sans PC) : images en lot (dimension max + qualité, ou taille CIBLE en Mo par recherche de la qualité) et vidéos (réduction de résolution et de débit
// en FILE D'ATTENTE avec une taille finale par fichier : js/video_transcode.js lit le MP4, décode et ré-encode plus vite que le temps réel (HEVC si possible), garde le son intact
// et calcule le débit pour tomber sur la taille demandée (2e passe si besoin) ; repli en temps réel (MediaRecorder) pour les autres formats). Tout est local.
(() => {
  const E = window.ENOS, esc = E.esc;
  const mo = (n) => (n < 1048576 ? (n / 1024).toFixed(0) + " Ko" : (n / 1048576).toFixed(2).replace(".", ",") + " Mo");

  /** Image -> Blob JPEG/WebP : côté max (px, 0 = d'origine) et qualité 0..1, ou taille cible en octets (recherche dichotomique de la qualité). */
  const shrink = async (file, o) => {
    const bmp = await createImageBitmap(file), k = o.maxSide ? Math.min(1, o.maxSide / Math.max(bmp.width, bmp.height)) : 1;
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = "high"; x.drawImage(bmp, 0, 0, c.width, c.height);
    const mime = o.format || "image/jpeg", blob = (q) => new Promise((res) => c.toBlob(res, mime, q));
    if (!o.target) return { blob: await blob(o.quality), w: c.width, h: c.height };
    let lo = 0.2, hi = 0.95, best = await blob(lo);
    if (best.size > o.target) return { blob: best, w: c.width, h: c.height, over: true };
    for (let i = 0; i < 7; i++) { const q = (lo + hi) / 2, b = await blob(q); if (b.size <= o.target) { best = b; lo = q; } else hi = q; }
    return { blob: best, w: c.width, h: c.height };
  };
  E.compress = { shrink };

  E.suite.register({
    id: "compress", group: "pro", title: "Compression", sub: "Images en lot · vidéo",
    icon: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
    build(el, A) {
      const $ = (s) => el.querySelector(s);
      el.innerHTML = `
        <div class="card"><div class="seg" id="cp-seg" data-p="enos"><button data-m="img" class="on">IMAGES</button><button data-m="vid">VIDÉO</button><i class="seg-ind"></i></div></div>
        <div id="cp-img" class="card"><h3>Images</h3>
          <div class="row"><button class="btn pri" id="ci-pick">CHOISIR DES IMAGES</button></div>
          <label class="fld" style="margin-top:10px">Côté maximal<b id="ci-sv"></b></label><input type="range" id="ci-s" min="0" max="8" value="3" style="width:100%;accent-color:var(--red)">
          <div class="seg" id="ci-mode" style="margin-top:10px"><button data-k="q" class="on">QUALITÉ</button><button data-k="t">TAILLE CIBLE</button><i class="seg-ind"></i></div>
          <div id="ci-q"><label class="fld">Qualité<b id="ci-qv"></b></label><input type="range" id="ci-qr" min="30" max="95" value="75" style="width:100%;accent-color:var(--red)"></div>
          <div id="ci-t" hidden><label class="fld">Chaque image ≤<b id="ci-tv"></b></label><input type="range" id="ci-tr" min="1" max="40" value="10" style="width:100%;accent-color:var(--red)"></div>
          <label class="chip2" style="display:inline-flex;gap:8px;margin-top:10px"><input type="checkbox" id="ci-webp"> Format WebP (plus léger)</label>
          <div class="list" id="ci-out" style="margin-top:10px"></div></div>
        <div id="cp-vid" class="card" hidden><h3>Vidéos</h3>
          <p class="muted" style="font-size:13.5px;margin-bottom:8px">Choisis la taille finale de chaque vidéo. Le son est gardé intact ; l'image est ré-encodée au mieux (HEVC si le téléphone sait), la résolution n'est réduite que si la taille demandée l'impose.</p>
          <div class="row"><button class="btn pri" id="cv-add">AJOUTER DES VIDÉOS</button></div>
          <div class="cv-def"><span>Taille par défaut des nouvelles vidéos</span><div class="cv-chips" id="cv-def">${[["p", 0.5, "−50 %"], ["p", 0.3, "−70 %"], ["p", 0.15, "−85 %"], ["m", 25, "25 Mo"], ["m", 50, "50 Mo"], ["m", 100, "100 Mo"]].map(([k, v, l]) => `<button data-k="${k}" data-v="${v}">${l}</button>`).join("")}</div></div>
          <div class="cv-q" id="cv-q"></div>
          <label class="chip2" style="display:inline-flex;gap:8px;margin-top:8px"><input type="checkbox" id="cv-auto" checked> Enregistrer chaque vidéo dès qu'elle est prête</label>
          <div class="row" style="margin-top:8px"><button class="btn pri" id="cv-go" disabled>TOUT COMPRESSER</button><button class="btn" id="cv-stop" hidden>ARRÊTER</button></div>
          <div class="muted" id="cv-sum" style="margin-top:6px;font-size:13px"></div></div>`;

      const SIDES = [0, 4096, 2560, 1920, 1600, 1280, 1024, 800, 640];
      const upd = () => {
        $("#ci-sv").textContent = SIDES[$("#ci-s").value] ? SIDES[$("#ci-s").value] + " px" : "d'origine"; $("#ci-qv").textContent = $("#ci-qr").value + " %"; $("#ci-tv").textContent = $("#ci-tr").value + " Mo";
      };
      el.querySelectorAll("input[type=range]").forEach((r) => (r.oninput = upd)); upd();
      $("#cp-seg").querySelectorAll("button").forEach((b) => (b.onclick = () => { $("#cp-seg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); $("#cp-seg").dataset.p = b.dataset.m === "img" ? "enos" : "eto"; $("#cp-img").hidden = b.dataset.m !== "img"; $("#cp-vid").hidden = b.dataset.m !== "vid"; }));
      $("#ci-mode").querySelectorAll("button").forEach((b) => (b.onclick = () => { $("#ci-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); $("#ci-q").hidden = b.dataset.k !== "q"; $("#ci-t").hidden = b.dataset.k !== "t"; }));

      // ---- images
      $("#ci-pick").onclick = async () => {
        const fs = await A.pick({ accept: "image/*", multiple: true }); if (!fs.length) return;
        const byTarget = $("#ci-mode .on").dataset.k === "t", webp = $("#ci-webp").checked, ext = webp ? "webp" : "jpg";
        $("#ci-out").innerHTML = ""; let before = 0, after = 0;
        for (const f of fs) {
          const row = document.createElement("div"); row.className = "it"; row.innerHTML = `<span class="n">${esc(f.name)}<small>compression…</small></span>`; $("#ci-out").append(row);
          try {
            const r = await shrink(f, { maxSide: SIDES[$("#ci-s").value], quality: $("#ci-qr").value / 100, target: byTarget ? $("#ci-tr").value * 1048576 : 0, format: webp ? "image/webp" : "image/jpeg" });
            before += f.size; after += r.blob.size;
            row.innerHTML = `<span class="n">${esc(f.name)}<small>${mo(f.size)} → ${mo(r.blob.size)} (−${Math.max(0, Math.round((1 - r.blob.size / f.size) * 100))} %) · ${r.w}×${r.h}${r.over ? " · cible trop basse" : ""}</small></span><button class="mini">ENREGISTRER</button>`;
            row.querySelector("button").onclick = async () => A.save(f.name.replace(/\.[^.]+$/, "") + "_min." + ext, webp ? "image/webp" : "image/jpeg", new Uint8Array(await r.blob.arrayBuffer()), "images");
          } catch (e) { row.innerHTML = `<span class="n">${esc(f.name)}<small>✕ ${esc(e.message)}</small></span>`; }
        }
        if (fs.length > 1) $("#ci-out").insertAdjacentHTML("beforeend", `<p class="muted" style="margin-top:8px">Total : ${mo(before)} → ${mo(after)}</p>`);
      };

      // ---- vidéos : file d'attente, taille finale par fichier
      const VX = E.vtx, Q = []; let qid = 0, running = false, sig = null, def = E.settings.get("compress.vdef", { k: "p", v: 0.3 });
      const fmtT = (s) => (s >= 60 ? Math.floor(s / 60) + " min " + String(Math.round(s % 60)).padStart(2, "0") : Math.round(s) + " s");
      const targetOf = (it) => (it.k === "m" ? it.v * 1048576 : Math.round(it.file.size * it.v));
      const paintDef = () => $("#cv-def").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.k === def.k && +b.dataset.v === def.v));
      $("#cv-def").querySelectorAll("button").forEach((b) => (b.onclick = () => { def = { k: b.dataset.k, v: +b.dataset.v }; E.settings.set("compress.vdef", def); paintDef(); })); paintDef();
      const row = (it) => $("#cv-q").querySelector(`[data-id="${it.id}"]`);
      const planOf = async (it) => { if (!it.info || !VX) return; try { const p = await VX.plan(it.info, targetOf(it)); it.plan = p; const r = row(it); if (r) r.querySelector(".cv-plan").textContent = "≈ " + p.label + (p.audioBytes ? " · son intact" : ""); } catch (e) { /* aperçu indisponible */ } };
      const paintIt = (it) => {
        const r = row(it); if (!r) return; const t = targetOf(it), pct = Math.round((1 - t / it.file.size) * 100);
        r.querySelector(".cv-mo").value = (t / 1048576).toFixed(t < 10485760 ? 1 : 0); r.querySelector(".cv-pct").textContent = pct > 0 ? "−" + pct + " %" : "plus grand que l'original";
        r.querySelectorAll(".cv-chips button").forEach((b) => b.classList.toggle("on", it.k === "p" && +b.dataset.p === it.v));
        r.querySelector(".cv-st").textContent = { wait: "En attente", run: it.stage || "Compression…", done: "Terminé", err: "✕ " + (it.err || "échec"), skip: "Déjà sous la taille demandée" }[it.status];
        r.querySelector(".rv-prog").hidden = it.status !== "run"; r.querySelector(".rv-prog i").style.width = Math.round((it.prog || 0) * 100) + "%";
        r.querySelector(".cv-t").classList.toggle("off", it.status === "run" || it.status === "done");
        const res = r.querySelector(".cv-res"); res.hidden = !(it.status === "done" && it.out) && it.status !== "skip";
        if (it.status === "done" && it.out) res.innerHTML = `<span>${mo(it.file.size)} → <b>${mo(it.out.blob.size)}</b> (−${Math.max(0, Math.round((1 - it.out.blob.size / it.file.size) * 100))} %)${it.out.plan ? " · " + esc(it.out.plan.label) : ""}${it.out.passes > 1 ? " · 2 passes" : ""}</span><button class="mini">${it.saved ? "ENREGISTRÉE" : "ENREGISTRER"}</button>`;
        if (it.status === "done" && it.out) res.querySelector("button").onclick = () => saveIt(it);
        sum();
      };
      const sum = () => { const d = Q.filter((x) => x.status === "done" && x.out), b0 = d.reduce((a, x) => a + x.file.size, 0), b1 = d.reduce((a, x) => a + x.out.blob.size, 0);
        $("#cv-sum").textContent = Q.length ? `${Q.length} vidéo${Q.length > 1 ? "s" : ""} · ${Q.filter((x) => x.status === "wait").length} en attente${d.length ? ` · gagné : ${mo(b0 - b1)} (${mo(b0)} → ${mo(b1)})` : ""}` : "";
        $("#cv-go").disabled = running || !Q.some((x) => x.status === "wait"); };
      const saveIt = async (it) => { if (!it.out) return; const ext = /mp4/.test(it.out.blob.type) ? "mp4" : "webm"; const ok = await A.save(it.file.name.replace(/\.[^.]+$/, "") + "_min." + ext, it.out.blob.type || "video/mp4", new Uint8Array(await it.out.blob.arrayBuffer()), "downloads"); if (ok !== false) { it.saved = true; paintIt(it); } };
      const addRow = (it) => {
        $("#cv-q").insertAdjacentHTML("beforeend", `<div class="cv-it" data-id="${it.id}"><div class="cv-h"><div><b>${esc(it.file.name)}</b><small class="cv-meta">${mo(it.file.size)} · analyse…</small></div><button class="mini cv-x" aria-label="Retirer">✕</button></div>
          <div class="cv-t"><span>Taille finale</span><input type="number" class="cv-mo" min="0.5" step="0.5" inputmode="decimal"><span>Mo</span><em class="cv-pct"></em></div>
          <div class="cv-chips">${[[0.5, "−50 %"], [0.3, "−70 %"], [0.15, "−85 %"], [0.08, "−92 %"]].map(([v, l]) => `<button data-p="${v}">${l}</button>`).join("")}</div>
          <div class="cv-plan muted"></div><div class="rv-prog" hidden><i></i></div><div class="cv-st"></div><div class="cv-res" hidden></div></div>`);
        const r = row(it);
        r.querySelector(".cv-x").onclick = () => { if (it.status === "run") return; Q.splice(Q.indexOf(it), 1); r.remove(); sum(); };
        r.querySelector(".cv-mo").onchange = (e) => { const v = parseFloat(String(e.target.value).replace(",", ".")); if (v > 0) { it.k = "m"; it.v = v; if (it.status === "skip" || it.status === "err") it.status = "wait"; paintIt(it); planOf(it); } };
        r.querySelectorAll(".cv-chips button").forEach((b) => (b.onclick = () => { if (it.status === "run") return; it.k = "p"; it.v = +b.dataset.p; if (it.status !== "done") it.status = "wait"; paintIt(it); planOf(it); }));
        paintIt(it);
      };
      $("#cv-add").onclick = async () => {
        const fs = await A.pick({ accept: "video/*", multiple: true }); if (!fs || !fs.length) return;
        for (const f of fs) { const it = { id: ++qid, file: f, k: def.k, v: def.v, status: "wait", prog: 0 }; Q.push(it); addRow(it);
          (async () => { try { it.info = VX && VX.supported() ? await VX.probe(f) : null; } catch (e) { it.info = null; }
            const meta = row(it) && row(it).querySelector(".cv-meta"); if (meta) { const v = it.info && it.info.tracks.video; meta.textContent = v ? `${mo(f.size)} · ${fmtT(it.info.duration)} · ${v.width}×${v.height}${v.rotation ? " (tournée)" : ""} · ${Math.round(v.fps)} i/s` : `${mo(f.size)} · mode compatible (temps réel)`; }
            planOf(it); })(); }
        sum();
      };
      /** repli : ré-encodage en temps réel (MediaRecorder) au débit qui vise la taille demandée */
      const realtime = (it, target) => new Promise((resolve, reject) => {
        const v = document.createElement("video"); v.playsInline = true; v.src = URL.createObjectURL(it.file);
        v.onerror = () => reject(new Error("vidéo illisible"));
        v.onloadedmetadata = async () => {
          const types = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"], mime = types.find((t) => MediaRecorder.isTypeSupported(t)); if (!mime) return reject(new Error("aucun format d'enregistrement"));
          const bits = Math.max(250000, (target * 8 * 0.95) / v.duration - 96000), short = Math.min(v.videoWidth, v.videoHeight), want = bits > 4e6 ? short : bits > 2e6 ? Math.min(short, 1080) : bits > 1e6 ? Math.min(short, 720) : Math.min(short, 480), k = want / short;
          const W = Math.round(v.videoWidth * k / 2) * 2, H = Math.round(v.videoHeight * k / 2) * 2, c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"), out = c.captureStream(30);
          try { const vs = v.captureStream ? v.captureStream() : null; if (vs) vs.getAudioTracks().forEach((t) => out.addTrack(t)); } catch (e) { /* sans son */ }
          const rec = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: Math.round(bits), audioBitsPerSecond: 96000 }), parts = []; rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
          let raf = 0; const draw = () => { x.drawImage(v, 0, 0, W, H); it.prog = v.currentTime / v.duration; paintIt(it); if (sig.stop) { v.pause(); rec.stop(); } raf = requestAnimationFrame(draw); };
          rec.onstop = () => { cancelAnimationFrame(raf); URL.revokeObjectURL(v.src); if (sig.stop) return reject(new Error("Annulé")); resolve({ blob: new Blob(parts, { type: mime.split(";")[0] }), plan: { label: `${Math.min(W, H)}p · temps réel` }, passes: 1 }); };
          v.onended = () => rec.stop(); v.volume = 0.0001; rec.start(1000); draw(); try { await v.play(); } catch (e) { rec.stop(); reject(new Error("lecture refusée : touche l'écran puis recommence")); }
        };
      });
      const runQueue = async () => {
        if (running) return; running = true; sig = { stop: false }; $("#cv-stop").hidden = false; sum();
        for (const it of Q) {
          if (sig.stop) break; if (it.status !== "wait") continue;
          const target = targetOf(it); if (target >= it.file.size) { it.status = "skip"; paintIt(it); continue; }
          it.status = "run"; it.prog = 0; it.stage = "Compression…"; paintIt(it);
          try {
            let out = null;
            if (VX && VX.supported() && it.info) { try { out = await VX.compress(it.file, target, { signal: sig, onProgress: (k, t) => { it.prog = k; it.stage = t + " · " + Math.round(k * 100) + " %"; paintIt(it); } }); } catch (e) { if (sig.stop) throw e; out = null; it.stage = "Mode compatible (temps réel)…"; } }
            if (!out) out = await realtime(it, target);
            it.out = out; it.status = "done"; paintIt(it);
            if ($("#cv-auto").checked) await saveIt(it);
          } catch (e) { it.status = sig.stop ? "wait" : "err"; it.err = e.message; paintIt(it); }
        }
        running = false; $("#cv-stop").hidden = true; sum();
      };
      $("#cv-go").onclick = runQueue;
      $("#cv-stop").onclick = () => { if (sig) sig.stop = true; };
      el._api = { shrink, queue: Q, runQueue, addFiles: (fs) => { for (const f of fs) { const it = { id: ++qid, file: f, k: def.k, v: def.v, status: "wait", prog: 0 }; Q.push(it); addRow(it); (async () => { try { it.info = VX && VX.supported() ? await VX.probe(f) : null; } catch (e) { it.info = null; } planOf(it); })(); } sum(); } };
    },
  });
})();
