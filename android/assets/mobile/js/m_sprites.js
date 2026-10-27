"use strict";
// IMAGES & ANIMATIONS (téléphone, sans PC) : découpe une planche de sprites (grille ou détection automatique), lit l'animation en pixel art (fps, zoom, fond),
// agrandit sans flou (×2 à ×8), retire un fond uni, exporte les images en ZIP de PNG. Tout est local (canvas).
(() => {
  const E = window.ENOS;

  // ---- ZIP « stocké » (sans compression) : suffisant pour des PNG déjà compressés
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u) => { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = crcT[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const zip = (files) => {                                          // [{name, data:Uint8Array}] -> Uint8Array
    const enc = new TextEncoder(), parts = [], cen = [];
    let off = 0;
    for (const f of files) {
      const nm = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      cen.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + f.data.length;
    }
    const cl = cen.reduce((s, p) => s + p.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cl, true); e.setUint32(16, off, true);
    const all = new Uint8Array(off + cl + 22); let o = 0;
    for (const p of [...parts, ...cen, new Uint8Array(e.buffer)]) { all.set(p, o); o += p.length; }
    return all;
  };
  /** Cadres d'une planche : grille cols × rows, ou composantes opaques (détection automatique). -> [{x,y,w,h}] */
  const gridFrames = (W, H, cols, rows) => { const out = [], cw = W / cols, ch = H / rows; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: Math.round(c * cw), y: Math.round(r * ch), w: Math.round((c + 1) * cw) - Math.round(c * cw), h: Math.round((r + 1) * ch) - Math.round(r * ch) }); return out; };
  const autoFrames = (img) => {                                      // composantes connexes (4 voisins) des pixels non transparents, fusionnées si leurs boîtes se touchent
    const { width: W, height: H, data: d } = img, seen = new Uint8Array(W * H), boxes = [];
    const solid = (i) => d[i * 4 + 3] > 24;
    for (let s = 0; s < W * H; s++) {
      if (seen[s] || !solid(s)) continue;
      let x0 = W, y0 = H, x1 = 0, y1 = 0; const st = [s]; seen[s] = 1;
      while (st.length) {
        const p = st.pop(), x = p % W, y = (p / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && !seen[q] && solid(q)) { seen[q] = 1; st.push(q); }
      }
      boxes.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
    let merged = true;
    while (merged) {                                                  // fusion des boîtes qui se chevauchent (une jambe détachée du corps)
      merged = false;
      for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length && !merged; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x < b.x + b.w + 1 && b.x < a.x + a.w + 1 && a.y < b.y + b.h + 1 && b.y < a.y + a.h + 1) {
          const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y); boxes[i] = { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 }; boxes.splice(j, 1); merged = true;
        }
      }
    }
    const rowTol = Math.max(4, (boxes.reduce((s, b) => s + b.h, 0) / (boxes.length || 1)) * 0.6);
    return boxes.filter((b) => b.w * b.h >= 12).sort((a, b) => (Math.abs(a.y - b.y) > rowTol ? a.y - b.y : a.x - b.x));        // ordre de lecture
  };
  E.sprites = { zip, crc32, gridFrames, autoFrames };

  E.suite.register({
    id: "sprites", group: "pro", title: "Images & animations", sub: "Planches · pixel art · ZIP",
    icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 17.5h7M17.5 14v7"/>',
    build(el, A) {
      const $ = (s) => el.querySelector(s);
      let img = null, data = null, frames = [], cur = 0, timer = 0, play = true, name = "sprites", bg = "#1b1b20";
      el.innerHTML = `
        <div class="card"><h3>Planche de sprites</h3>
          <div class="row"><button class="btn pri" id="sp-pick">CHOISIR UNE IMAGE</button></div><div class="muted" id="sp-info" style="margin-top:8px;font-size:13px"></div></div>
        <div id="sp-main" hidden>
          <div class="card"><h3>Découpe</h3>
            <div class="seg" id="sp-seg" data-p="enos"><button data-m="grid" class="on">GRILLE</button><button data-m="auto">AUTO</button><i class="seg-ind"></i></div>
            <div id="sp-gridin"><label class="fld" style="margin-top:10px">Colonnes<b id="sp-cv">4</b></label><input type="range" id="sp-c" min="1" max="32" value="4" style="width:100%;accent-color:var(--red)">
              <label class="fld">Lignes<b id="sp-rv">1</b></label><input type="range" id="sp-r" min="1" max="32" value="1" style="width:100%;accent-color:var(--red)"></div>
            <canvas id="sp-sheet" style="width:100%;margin-top:10px;border-radius:10px;image-rendering:pixelated;background:#101014"></canvas>
            <div class="muted" id="sp-fn" style="font-size:13px;margin-top:4px"></div></div>
          <div class="card"><h3>Animation</h3>
            <canvas id="sp-anim" style="width:100%;max-height:260px;border-radius:10px;image-rendering:pixelated;background:#1b1b20"></canvas>
            <label class="fld">Vitesse<b id="sp-fv">8 images/s</b></label><input type="range" id="sp-f" min="1" max="30" value="8" style="width:100%;accent-color:var(--red)">
            <div class="row" style="margin-top:6px"><button class="btn" id="sp-pp">⏸ PAUSE</button><button class="btn" id="sp-prev">◂</button><button class="btn" id="sp-next">▸</button><button class="btn" id="sp-bg">FOND</button></div></div>
          <div class="card"><h3>Exporter</h3>
            <label class="fld">Agrandissement (sans flou)<b id="sp-sv">×1</b></label><input type="range" id="sp-s" min="1" max="8" value="1" style="width:100%;accent-color:var(--red)">
            <label class="chip2" style="display:inline-flex;gap:8px;margin:8px 0"><input type="checkbox" id="sp-nobg"> Retirer le fond uni (couleur du coin)</label>
            <div class="row"><button class="btn pri" id="sp-zip">TOUTES LES IMAGES (ZIP)</button><button class="btn" id="sp-one">IMAGE COURANTE (PNG)</button></div></div>
        </div>`;

      const mode = () => ($("#sp-seg .on") || {}).dataset.m || "grid";
      function cut() {
        if (!img) return;
        frames = mode() === "auto" ? autoFrames(data) : gridFrames(img.width, img.height, +$("#sp-c").value, +$("#sp-r").value);
        $("#sp-gridin").hidden = mode() === "auto"; $("#sp-cv").textContent = $("#sp-c").value; $("#sp-rv").textContent = $("#sp-r").value;
        $("#sp-fn").textContent = frames.length + " image" + (frames.length > 1 ? "s" : "") + (frames[0] ? " · " + frames[0].w + "×" + frames[0].h + " px" : "");
        cur = 0; sheet(); frame();
      }
      function sheet() {
        const c = $("#sp-sheet"), x = c.getContext("2d"); c.width = img.width; c.height = img.height; x.drawImage(img, 0, 0);
        x.strokeStyle = "#1acfd6"; x.lineWidth = Math.max(1, img.width / 400); frames.forEach((f, i) => { x.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1); });
      }
      function frame() {
        const f = frames[cur % (frames.length || 1)], c = $("#sp-anim"), x = c.getContext("2d");
        if (!f) return;
        c.width = f.w; c.height = f.h; x.clearRect(0, 0, f.w, f.h); x.fillStyle = bg; x.fillRect(0, 0, f.w, f.h); x.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      }
      function restart() { clearInterval(timer); $("#sp-fv").textContent = $("#sp-f").value + " images/s"; if (play && frames.length > 1) timer = setInterval(() => { if (!el.closest(".subview") || el.closest(".subview").hidden) return; cur = (cur + 1) % frames.length; frame(); }, 1000 / +$("#sp-f").value); }

      async function load(file) {
        try {
          const bmp = await createImageBitmap(file), c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
          const x = c.getContext("2d"); x.drawImage(bmp, 0, 0); img = c; data = x.getImageData(0, 0, c.width, c.height);
          name = file.name.replace(/\.[^.]+$/, ""); $("#sp-main").hidden = false;
          $("#sp-info").textContent = `${file.name} · ${c.width}×${c.height} px`;
          $("#sp-c").max = Math.min(64, c.width); $("#sp-r").max = Math.min(64, c.height);
          const auto = autoFrames(data);                                // proposition de départ : si la planche se détecte proprement, on la prend
          if (auto.length > 1 && auto.length < 200) { $("#sp-seg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.m === "auto")); $("#sp-seg").dataset.p = "eto"; }
          cut(); restart();
        } catch (e) { $("#sp-info").textContent = "✕ Image illisible : " + e.message; }
      }
      $("#sp-pick").onclick = async () => { const f = (await A.pick({ accept: "image/*" }))[0]; if (f) load(f); };
      $("#sp-seg").querySelectorAll("button").forEach((b) => (b.onclick = () => { $("#sp-seg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); $("#sp-seg").dataset.p = b.dataset.m === "grid" ? "enos" : "eto"; cut(); restart(); }));
      ["#sp-c", "#sp-r"].forEach((q) => ($(q).oninput = () => { cut(); restart(); }));
      $("#sp-f").oninput = restart;
      $("#sp-s").oninput = () => { $("#sp-sv").textContent = "×" + $("#sp-s").value; };
      $("#sp-pp").onclick = () => { play = !play; $("#sp-pp").textContent = play ? "⏸ PAUSE" : "▶ LECTURE"; restart(); };
      $("#sp-prev").onclick = () => { cur = (cur - 1 + frames.length) % frames.length; frame(); };
      $("#sp-next").onclick = () => { cur = (cur + 1) % frames.length; frame(); };
      const BGS = ["#1b1b20", "#000000", "#ffffff", "#2d7a3e", "#4a6fe3", "#c9a84c"];
      $("#sp-bg").onclick = () => { bg = BGS[(BGS.indexOf(bg) + 1) % BGS.length]; frame(); };

      const cropPng = (f) => new Promise((res) => {
        const k = +$("#sp-s").value, c = document.createElement("canvas"); c.width = f.w * k; c.height = f.h * k;
        const x = c.getContext("2d"); x.imageSmoothingEnabled = false; x.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, c.width, c.height);
        if ($("#sp-nobg").checked) {
          const d = x.getImageData(0, 0, c.width, c.height), p = d.data, r0 = p[0], g0 = p[1], b0 = p[2];
          for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - r0) + Math.abs(p[i + 1] - g0) + Math.abs(p[i + 2] - b0) < 36) p[i + 3] = 0;
          x.putImageData(d, 0, 0);
        }
        c.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), "image/png");
      });
      $("#sp-zip").onclick = async () => {
        if (!frames.length) return;
        const files = []; for (let i = 0; i < frames.length; i++) files.push({ name: `${name}_${String(i + 1).padStart(3, "0")}.png`, data: await cropPng(frames[i]) });
        A.save(name + "_frames.zip", "application/zip", zip(files), "downloads");
      };
      $("#sp-one").onclick = async () => { if (frames.length) A.save(`${name}_${String(cur + 1).padStart(3, "0")}.png`, "image/png", await cropPng(frames[cur]), "images"); };
      el._api = { load, get frames() { return frames; } };
    },
  });
})();
