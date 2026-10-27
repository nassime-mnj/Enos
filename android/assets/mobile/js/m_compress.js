"use strict";
// COMPRESSION (téléphone, sans PC) : images en lot (dimension max + qualité, ou taille CIBLE en Mo par recherche de la qualité) et vidéos (réduction de résolution et de débit
// par ré-encodage du téléphone via MediaRecorder : le temps de traitement égale la durée de la vidéo). Tout est local.
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
        <div id="cp-vid" class="card" hidden><h3>Vidéo</h3>
          <p class="muted" style="font-size:13.5px;margin-bottom:8px">La vidéo est ré-encodée par ton téléphone : garde l'application ouverte, la durée du traitement est celle de la vidéo.</p>
          <div class="row"><button class="btn pri" id="cv-pick">CHOISIR UNE VIDÉO</button></div>
          <label class="fld" style="margin-top:10px">Hauteur<b id="cv-hv"></b></label><input type="range" id="cv-h" min="0" max="3" value="1" style="width:100%;accent-color:var(--red)">
          <label class="fld">Débit vidéo<b id="cv-bv"></b></label><input type="range" id="cv-b" min="3" max="40" value="12" style="width:100%;accent-color:var(--red)">
          <video id="cv-v" playsinline muted style="width:100%;border-radius:10px;margin-top:8px;background:#000" hidden></video>
          <div class="row" style="margin-top:8px"><button class="btn pri" id="cv-go" disabled>COMPRESSER</button></div>
          <div class="rv-prog" id="cv-p" hidden><i></i></div><div class="muted" id="cv-info" style="margin-top:6px;font-size:13px"></div></div>`;

      const SIDES = [0, 4096, 2560, 1920, 1600, 1280, 1024, 800, 640], VH = [360, 480, 720, 1080];
      const upd = () => {
        $("#ci-sv").textContent = SIDES[$("#ci-s").value] ? SIDES[$("#ci-s").value] + " px" : "d'origine"; $("#ci-qv").textContent = $("#ci-qr").value + " %"; $("#ci-tv").textContent = $("#ci-tr").value + " Mo";
        $("#cv-hv").textContent = VH[$("#cv-h").value] + " p"; $("#cv-bv").textContent = ($("#cv-b").value / 10).toFixed(1).replace(".", ",") + " Mb/s";
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

      // ---- vidéo
      let vfile = null;
      $("#cv-pick").onclick = async () => {
        const f = (await A.pick({ accept: "video/*" }))[0]; if (!f) return;
        vfile = f; const v = $("#cv-v"); v.hidden = false; v.src = URL.createObjectURL(f); v.onloadedmetadata = () => { $("#cv-info").textContent = `${f.name} · ${mo(f.size)} · ${v.videoWidth}×${v.videoHeight} · ${Math.round(v.duration)} s`; $("#cv-go").disabled = !window.MediaRecorder; };
        if (!window.MediaRecorder) $("#cv-info").textContent = "Ce téléphone ne sait pas ré-encoder la vidéo dans l'application.";
      };
      $("#cv-go").onclick = async () => {
        const v = $("#cv-v"); if (!vfile || !window.MediaRecorder) return;
        const types = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"], mime = types.find((t) => MediaRecorder.isTypeSupported(t));
        if (!mime) return ($("#cv-info").textContent = "Aucun format d'enregistrement disponible.");
        $("#cv-go").disabled = true; $("#cv-p").hidden = false; const bar = $("#cv-p i"); bar.style.width = "2%";
        const H = Math.min(VH[$("#cv-h").value], v.videoHeight), W = Math.round(v.videoWidth * H / v.videoHeight / 2) * 2, c = document.createElement("canvas"); c.width = W; c.height = H;
        const x = c.getContext("2d"), out = c.captureStream(30);
        try { v.muted = false; const vs = v.captureStream ? v.captureStream() : null; if (vs) vs.getAudioTracks().forEach((t) => out.addTrack(t)); } catch (e) { /* sans son */ }
        const rec = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: $("#cv-b").value * 100000 }), parts = [];
        rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
        let raf = 0; const draw = () => { x.drawImage(v, 0, 0, W, H); bar.style.width = Math.max(2, Math.min(99, v.currentTime / v.duration * 100)) + "%"; raf = requestAnimationFrame(draw); };
        const done = new Promise((res) => { rec.onstop = res; v.onended = () => { cancelAnimationFrame(raf); rec.stop(); }; });
        v.currentTime = 0; v.volume = 0.0001; rec.start(1000); draw();
        try { await v.play(); } catch (e) { cancelAnimationFrame(raf); rec.stop(); $("#cv-info").textContent = "✕ Lecture refusée : touche d'abord l'écran puis recommence."; $("#cv-go").disabled = false; return; }
        await done; v.volume = 1; v.muted = true;
        const blob = new Blob(parts, { type: mime.split(";")[0] }), ext = /mp4/.test(mime) ? "mp4" : "webm";
        $("#cv-info").textContent = `${mo(vfile.size)} → ${mo(blob.size)} (−${Math.max(0, Math.round((1 - blob.size / vfile.size) * 100))} %) · ${W}×${H}`;
        $("#cv-p").hidden = true; $("#cv-go").disabled = false;
        A.save(vfile.name.replace(/\.[^.]+$/, "") + "_min." + ext, blob.type, new Uint8Array(await blob.arrayBuffer()), "downloads");
      };
      el._api = { shrink };
    },
  });
})();
