"use strict";
// ÉDITEUR PDF (parité avec l'Éditeur PDF du PC) : tout se passe sur le téléphone, avec pdf-lib (écriture) et pdf.js (aperçus).
// Modèle : une liste de PAGES (source + numéro + rotation ajoutée) ; l'original n'est jamais modifié, l'export reconstruit un nouveau PDF.
(() => {
  const E = window.ENOS;
  const SIZE_A4 = [595.28, 841.89];

  const fmt = (n) => (n < 1024 ? n + " o" : n < 1048576 ? (n / 1024).toFixed(1).replace(".", ",") + " Ko" : (n / 1048576).toFixed(2).replace(".", ",") + " Mo");
  const baseName = (n) => String(n || "document").replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim() || "document";
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const plural = (n, w) => n + " " + w + (n > 1 ? "s" : "");

  // plages « 1-3,5,8- » -> [[a,b],…] (bornes incluses, 1 = première page)
  function parseRanges(txt, n) {
    const parts = String(txt || "").split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) throw new Error("Indique des pages, par exemple « 1-3,5,8- ».");
    return parts.map((p) => {
      const m = /^(\d*)\s*-\s*(\d*)$/.exec(p) || /^(\d+)$/.exec(p);
      if (!m || (m.length === 3 && !m[1] && !m[2])) throw new Error(`Plage invalide : « ${p} ». Exemple : 1-3,5,8-`);
      const a = m.length === 2 ? +m[1] : (m[1] ? +m[1] : 1), b = m.length === 2 ? +m[1] : (m[2] ? +m[2] : n);
      if (a < 1 || b < 1 || a > n || b > n) throw new Error(`Plage hors limites : « ${p} » (le document a ${plural(n, "page")}).`);
      if (a > b) throw new Error(`Plage à l'envers : « ${p} ».`);
      return [a, b];
    });
  }

  // orientation EXIF d'un JPEG (1 = normal) : pdf-lib ne la applique pas, on ré-encode alors via un canevas
  function exifOrientation(b) {
    if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
    let o = 2;
    while (o + 4 < b.length && b[o] === 0xff) {
      const mk = b[o + 1], len = (b[o + 2] << 8) | b[o + 3];
      if (mk === 0xe1 && b[o + 4] === 0x45 && b[o + 5] === 0x78) {
        const t = o + 10, le = b[t] === 0x49, u16 = (p) => (le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
        const u32 = (p) => (le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0);
        const ifd = t + u32(t + 4), cnt = u16(ifd);
        for (let i = 0; i < cnt; i++) { const e = ifd + 2 + i * 12; if (u16(e) === 0x0112) return u16(e + 8) || 1; }
        return 1;
      }
      o += 2 + len;
    }
    return 1;
  }
  const canvasBytes = (c, type, q) => new Promise((res, rej) => c.toBlob((bl) => (bl ? bl.arrayBuffer().then((x) => res(new Uint8Array(x))) : rej(new Error("encodage de l'image impossible"))), type, q));

  E.suite.register({
    id: "pdf", group: "pro", title: "Éditeur PDF", sub: "Fusionner, scinder, pivoter, compresser",
    icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6"/>',
    build(el, A) {
      const $ = (s) => el.querySelector(s);
      el.innerHTML = `
        <div class="card">
          <div class="row"><button class="btn pri" id="pdf-open">Ouvrir des PDF</button><button class="btn" id="pdf-img">Images → PDF</button></div>
          <div class="pdf-files" id="pdf-files"></div>
          <p class="err" id="pdf-err" hidden></p>
        </div>
        <div class="card" id="pdf-pages-card" hidden>
          <div class="pdf-head"><b id="pdf-count"></b><span class="muted" id="pdf-selinfo"></span></div>
          <div class="pdf-tools">
            <button class="btn" data-op="all">Tout</button><button class="btn" data-op="none">Aucune</button>
            <button class="btn" data-op="left">⟲ 90°</button><button class="btn" data-op="right">⟳ 90°</button>
            <button class="btn" data-op="up">◂ Avant</button><button class="btn" data-op="down">Après ▸</button>
            <button class="btn" data-op="dup">Dupliquer</button><button class="btn warn" data-op="del">Supprimer</button>
          </div>
          <div class="pdf-grid" id="pdf-grid"></div>
          <p class="muted pdf-hint">Touche des pages pour les sélectionner, puis utilise les boutons.</p>
        </div>
        <div class="card" id="pdf-range-card" hidden>
          <label class="muted" for="pdf-ranges">Plages de pages</label>
          <input type="text" id="pdf-ranges" placeholder="1-3,5,8-" autocomplete="off" autocapitalize="off" spellcheck="false">
          <div class="row"><button class="btn" id="pdf-extract">Extraire</button><button class="btn" id="pdf-split">Scinder</button></div>
          <p class="muted pdf-hint">Extraire : un seul PDF avec ces pages. Scinder : un PDF par plage.</p>
        </div>
        <div class="card" id="pdf-opt-card" hidden>
          <label class="muted" for="pdf-name">Nom du fichier de sortie</label>
          <input type="text" id="pdf-name" autocomplete="off" spellcheck="false">
          <label class="pdf-chk"><input type="checkbox" id="pdf-num"><span>Numéroter les pages</span></label>
          <div class="pdf-sub" id="pdf-num-o" hidden><select id="pdf-numfmt"><option value="n">1, 2, 3…</option><option value="nn">1 / N</option><option value="p">Page 1</option></select></div>
          <label class="pdf-chk"><input type="checkbox" id="pdf-wm"><span>Filigrane (texte en diagonale)</span></label>
          <div class="pdf-sub" id="pdf-wm-o" hidden>
            <input type="text" id="pdf-wmtxt" value="CONFIDENTIEL" maxlength="60" autocomplete="off">
            <label class="muted">Opacité : <b id="pdf-wmop-v">25 %</b></label><input type="range" id="pdf-wmop" min="5" max="70" value="25" class="pdf-range">
          </div>
          <label class="pdf-chk"><input type="checkbox" id="pdf-meta"><span>Effacer les métadonnées (titre, auteur…)</span></label>
          <label class="muted" for="pdf-comp">Compression</label>
          <select id="pdf-comp"><option value="none">Aucune</option><option value="std" selected>Standard (réécriture compacte)</option><option value="agg">Agressive (pages en images JPEG)</option></select>
          <div class="pdf-sub" id="pdf-agg-o" hidden>
            <label class="muted">Qualité JPEG : <b id="pdf-q-v">70 %</b></label><input type="range" id="pdf-q" min="50" max="90" value="70" class="pdf-range">
            <label class="muted" for="pdf-scale">Résolution</label>
            <select id="pdf-scale"><option value="1">Basse (72 ppp)</option><option value="1.5" selected>Moyenne (108 ppp)</option><option value="2">Haute (144 ppp)</option></select>
            <p class="muted pdf-hint">Le texte n'est plus sélectionnable après une compression agressive.</p>
          </div>
          <button class="btn pri wide" id="pdf-export">Exporter</button>
          <p class="ok" id="pdf-ok" hidden></p>
        </div>`;

      // ---------------------------------------------------------------- état
      const srcs = [];           // { id, name, bytes, doc, n }
      let pages = [];            // { id, s, n, rot }
      const sel = new Set();
      let nid = 1, busy = false, nameEdited = false;

      const msg = (t, kind) => {
        const e = $("#pdf-err"), o = $("#pdf-ok");
        e.hidden = kind !== "err" || !t; o.hidden = kind !== "ok" || !t;
        (kind === "err" ? e : o).textContent = t || "";
      };
      const setBusy = (b, label) => {
        const was = busy; busy = b;
        el.querySelectorAll("button").forEach((x) => { if (b) { if (!was) { x._was = x.disabled; x.disabled = true; } } else x.disabled = !!x._was; });
        const ex = $("#pdf-export"); ex.textContent = b && label ? label : exportLabel();
      };
      const guard = (fn) => async (...a) => {
        if (busy) return;
        try { await fn(...a); } catch (e) { console.error("[pdf]", e); const t = (e && e.message) || "Opération impossible."; msg(t, "err"); A.toast(t, "err"); setBusy(false); }
      };

      // ---------------------------------------------------------------- vignettes (rendu paresseux, un à la fois)
      const cache = new Map(), queue = [];
      let pumping = false;
      async function pump() {
        if (pumping) return; pumping = true;
        while (queue.length) {
          const j = queue.shift();
          try {
            let c = cache.get(j.key);
            if (!c) { c = await A.pdfRender(j.s.doc, j.n, 0.3); cache.set(j.key, c); }
            if (j.cell.isConnected) j.done(c);
          } catch (e) { if (j.cell.isConnected) j.cell.classList.add("bad"); }
          await tick();
        }
        pumping = false;
      }
      const rotated = (base, rot) => {
        const c = document.createElement("canvas"), odd = rot % 180 !== 0;
        c.width = odd ? base.height : base.width; c.height = odd ? base.width : base.height;
        const x = c.getContext("2d"); x.translate(c.width / 2, c.height / 2); x.rotate((rot * Math.PI) / 180); x.drawImage(base, -base.width / 2, -base.height / 2);
        return c;
      };
      let io = null;
      function wantThumb(cell, p) {
        const key = p.s.id + ":" + p.n, th = cell.querySelector(".pdf-th");
        const paint = (base) => { th.textContent = ""; th.appendChild(rotated(base, p.rot)); };
        const hit = cache.get(key);
        if (hit) return paint(hit);
        queue.push({ key, s: p.s, n: p.n, cell, done: paint }); pump();
      }

      // ---------------------------------------------------------------- affichage
      const exportLabel = () => (sel.size ? `Exporter la sélection (${plural(sel.size, "page")})` : `Exporter (${plural(pages.length, "page")})`);
      function renderFiles() {
        const box = $("#pdf-files"); box.textContent = "";
        srcs.forEach((s, i) => {
          const r = document.createElement("div"); r.className = "pdf-file";
          const t = document.createElement("div"); t.className = "pdf-fn";
          const b = document.createElement("b"); b.textContent = s.name;
          const sm = document.createElement("small"); sm.textContent = plural(s.n, "page") + " · " + fmt(s.bytes.length);
          t.append(b, sm); r.appendChild(t);
          [["▲", "Monter", -1], ["▼", "Descendre", 1], ["✕", "Retirer", 0]].forEach(([g, label, d]) => {
            const x = document.createElement("button"); x.className = "btn pdf-ib"; x.textContent = g; x.title = label; x.setAttribute("aria-label", label + " " + s.name);
            x.disabled = d === -1 ? i === 0 : d === 1 ? i === srcs.length - 1 : false;
            x.onclick = () => (d ? moveSrc(i, d) : removeSrc(i));
            r.appendChild(x);
          });
          box.appendChild(r);
        });
      }
      function render() {
        const has = pages.length > 0;
        ["#pdf-pages-card", "#pdf-range-card", "#pdf-opt-card"].forEach((s) => ($(s).hidden = !has));
        renderFiles();
        $("#pdf-count").textContent = plural(pages.length, "page") + (srcs.length > 1 ? " · " + plural(srcs.length, "fichier") : "");
        $("#pdf-selinfo").textContent = sel.size ? sel.size + " sélectionnée" + (sel.size > 1 ? "s" : "") : "";
        $("#pdf-export").textContent = exportLabel();
        const g = $("#pdf-grid"); g.textContent = "";
        if (io) io.disconnect();
        io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); wantThumb(en.target, en.target._p); } }), { rootMargin: "300px" }) : null;
        pages.forEach((p, i) => {
          const c = document.createElement("div"); c.className = "pdf-cell" + (sel.has(p.id) ? " sel" : ""); c._p = p; c.dataset.id = p.id; c.setAttribute("role", "button"); c.tabIndex = 0;
          c.setAttribute("aria-label", "Page " + (i + 1) + (sel.has(p.id) ? " sélectionnée" : ""));
          const th = document.createElement("div"); th.className = "pdf-th";
          const nb = document.createElement("span"); nb.className = "pdf-no"; nb.textContent = i + 1;
          const lb = document.createElement("small"); lb.textContent = (srcs.length > 1 ? baseName(p.s.name).slice(0, 10) + " · " : "") + "p." + p.n + (p.rot ? " · " + p.rot + "°" : "");
          c.append(th, nb, lb);
          c.onclick = () => { if (sel.has(p.id)) sel.delete(p.id); else sel.add(p.id); c.classList.toggle("sel", sel.has(p.id)); $("#pdf-selinfo").textContent = sel.size ? sel.size + " sélectionnée" + (sel.size > 1 ? "s" : "") : ""; $("#pdf-export").textContent = exportLabel(); };
          c.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); c.click(); } };
          g.appendChild(c);
          if (io) io.observe(c); else wantThumb(c, p);
        });
        if (!nameEdited && srcs.length) $("#pdf-name").value = baseName(srcs[0].name) + (srcs.length > 1 ? "_fusion" : "_modifie") + ".pdf";
      }

      // ---------------------------------------------------------------- fichiers
      async function addPdfs(files) {
        const bad = [];
        for (const f of files) {
          try {
            const bytes = await A.read(f);
            const doc = await A.pdfOpen(bytes);
            const s = { id: nid++, name: f.name || "document.pdf", bytes, doc, n: doc.numPages };
            srcs.push(s);
            for (let i = 1; i <= s.n; i++) pages.push({ id: nid++, s, n: i, rot: 0 });
          } catch (e) { bad.push((f.name || "fichier") + " : " + ((e && e.message) || "illisible")); }
        }
        render();
        if (bad.length) { msg(bad.join("\n"), "err"); A.toast(bad.length === 1 ? bad[0] : bad.length + " fichiers refusés", "err"); }
        else msg("");
      }
      function regroup() { const order = new Map(srcs.map((s, i) => [s, i])); pages = pages.map((p, i) => [p, i]).sort((a, b) => order.get(a[0].s) - order.get(b[0].s) || a[1] - b[1]).map((x) => x[0]); }
      function moveSrc(i, d) { const j = i + d; if (j < 0 || j >= srcs.length) return; [srcs[i], srcs[j]] = [srcs[j], srcs[i]]; regroup(); render(); }
      function removeSrc(i) {
        const s = srcs[i]; srcs.splice(i, 1);
        pages = pages.filter((p) => { if (p.s === s) { sel.delete(p.id); return false; } return true; });
        try { s.doc.destroy(); } catch (e) { /* déjà libéré */ }
        render();
      }

      $("#pdf-open").onclick = guard(async () => {
        const fs = await A.pick({ accept: "application/pdf,.pdf", multiple: true });
        if (fs.length) { setBusy(true, "Lecture…"); await addPdfs(fs); setBusy(false); }
      });

      // ---------------------------------------------------------------- opérations sur les pages
      el.querySelectorAll("[data-op]").forEach((b) => (b.onclick = () => {
        const op = b.dataset.op;
        if (op === "all") { pages.forEach((p) => sel.add(p.id)); return render(); }
        if (op === "none") { sel.clear(); return render(); }
        if (!sel.size) { A.toast("Touche d'abord des pages.", "warn"); return; }
        if (op === "left" || op === "right") pages.forEach((p) => { if (sel.has(p.id)) p.rot = (p.rot + (op === "right" ? 90 : 270)) % 360; });
        else if (op === "del") {
          if (sel.size >= pages.length) { A.toast("Il doit rester au moins une page.", "warn"); return; }
          pages = pages.filter((p) => !sel.has(p.id)); sel.clear();
        } else if (op === "dup") {
          const out = []; pages.forEach((p) => { out.push(p); if (sel.has(p.id)) out.push({ id: nid++, s: p.s, n: p.n, rot: p.rot }); }); pages = out;
        } else if (op === "up") { for (let i = 1; i < pages.length; i++) if (sel.has(pages[i].id) && !sel.has(pages[i - 1].id)) [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; }
        else if (op === "down") { for (let i = pages.length - 2; i >= 0; i--) if (sel.has(pages[i].id) && !sel.has(pages[i + 1].id)) [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; }
        msg(""); render();
      }));

      // ---------------------------------------------------------------- Images → PDF
      $("#pdf-img").onclick = guard(async () => {
        const files = await A.pick({ accept: "image/jpeg,image/png,image/*", multiple: true });
        if (!files.length) return;
        setBusy(true, "Création du PDF…");
        const mode = await new Promise((res) => {
          const d = document.createElement("div"); d.className = "pdf-modal";
          d.innerHTML = '<div class="card"><p><b>Taille des pages</b></p><button class="btn pri wide" data-m="a4">A4 (image ajustée)</button><button class="btn wide" data-m="img">Taille de l\'image</button><button class="btn wide" data-m="">Annuler</button></div>';
          d.querySelectorAll("button").forEach((b) => (b.onclick = () => { d.remove(); res(b.dataset.m); }));
          el.appendChild(d); d.querySelector("button").focus();
        });
        if (!mode) { setBusy(false); return; }
        const L = await A.pdflib(), doc = await L.PDFDocument.create({ updateMetadata: false });
        let ok = 0; const bad = [];
        for (const f of files) {
          try {
            let b = await A.read(f), img;
            const isPng = b[0] === 0x89 && b[1] === 0x50, isJpg = b[0] === 0xff && b[1] === 0xd8;
            if (isJpg && exifOrientation(b) === 1) img = await doc.embedJpg(b);
            else if (isPng) img = await doc.embedPng(b);
            else {                                    // JPEG pivoté (EXIF), WebP, etc. : décodage par le navigateur
              const bm = await createImageBitmap(new Blob([b]));
              const c = document.createElement("canvas"); c.width = bm.width; c.height = bm.height; c.getContext("2d").drawImage(bm, 0, 0); bm.close && bm.close();
              img = await doc.embedJpg(await canvasBytes(c, "image/jpeg", 0.92));
            }
            let pw, ph;
            if (mode === "img") { pw = img.width * 0.75; ph = img.height * 0.75; }
            else { [pw, ph] = img.width > img.height ? [SIZE_A4[1], SIZE_A4[0]] : SIZE_A4; }
            const pg = doc.addPage([pw, ph]), m = mode === "img" ? 0 : 20, k = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
            const w = img.width * k, h = img.height * k;
            pg.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
            ok++;
          } catch (e) { bad.push(f.name || "image"); }
          await tick();
        }
        if (!ok) throw new Error("Aucune image utilisable (JPEG ou PNG attendus)" + (bad.length ? " : " + bad.join(", ") : "") + ".");
        const bytes = await doc.save();
        await addPdfs([new File([bytes], "Images.pdf", { type: "application/pdf" })]);
        setBusy(false);
        if (bad.length) { msg("Ignorées : " + bad.join(", "), "err"); }
        A.toast(plural(ok, "image") + " ajoutée" + (ok > 1 ? "s" : "") + " au document.", "ok");
      });

      // ---------------------------------------------------------------- construction du PDF de sortie
      async function produce(list0, o) {
        const list = list0.map((p) => ({ s: p.s, n: p.n, rot: p.rot }));      // entrées distinctes (une plage peut répéter une page)
        const L = await A.pdflib(), { PDFDocument, PDFName, StandardFonts, rgb, degrees } = L;
        const out = await PDFDocument.create({ updateMetadata: false });
        // copie par lots : une même page dupliquée a besoin d'une copie distincte
        const batches = [];
        list.forEach((p) => {
          let b = batches.find((x) => x.s === p.s && !x.idx.has(p.n - 1));
          if (!b) { b = { s: p.s, idx: new Map() }; batches.push(b); }
          b.idx.set(p.n - 1, p);
        });
        const made = new Map(), docs = new Map();
        for (const b of batches) {
          let d = docs.get(b.s);
          if (!d) { try { d = await PDFDocument.load(b.s.bytes, { updateMetadata: false }); } catch (e) { throw new Error(`« ${b.s.name} » est chiffré ou illisible : modification impossible.`); } docs.set(b.s, d); }
          const keys = Array.from(b.idx.keys()), cp = await out.copyPages(d, keys);
          keys.forEach((k, i) => made.set(b.idx.get(k), cp[i]));
          await tick();
        }
        const total = list.length;
        list.forEach((p) => {
          const pg = made.get(p);
          if (!pg) return;
          pg.setRotation(degrees(((pg.getRotation().angle || 0) + p.rot + 360) % 360));
        });
        // les doublons : même objet de page pour (s,n)? non, chaque (s,n) d'un lot est distinct ; on ajoute dans l'ordre de la liste
        list.forEach((p) => out.addPage(made.get(p)));
        const outPages = out.getPages();
        const font = (o.num || o.wm) ? await out.embedFont(StandardFonts.Helvetica) : null;
        outPages.forEach((pg, i) => {
          const { width: W, height: H } = pg.getSize(), r = ((pg.getRotation().angle % 360) + 360) % 360;
          const v2c = (vx, vy) => (r === 90 ? [W - vy, vx] : r === 180 ? [W - vx, H - vy] : r === 270 ? [vy, H - vx] : [vx, vy]);
          const VW = r % 180 ? H : W;
          if (o.wm) {
            const txt = o.wmText, w100 = font.widthOfTextAtSize(txt, 100), diag = Math.hypot(W, H);
            const size = Math.max(10, Math.min(140, (0.7 * diag * 100) / w100)), w = (w100 * size) / 100;
            const th = ((45 + r) * Math.PI) / 180, [cx, cy] = [W / 2, H / 2], off = size * 0.3;
            pg.drawText(txt, { x: cx - (w / 2) * Math.cos(th) + off * Math.sin(th), y: cy - (w / 2) * Math.sin(th) - off * Math.cos(th), size, font, color: rgb(0.45, 0.45, 0.45), opacity: o.wmOp, rotate: degrees((45 + r) % 360) });
          }
          if (o.num) {
            const label = o.numFmt === "nn" ? `${i + 1} / ${total}` : o.numFmt === "p" ? `Page ${i + 1}` : String(i + 1);
            const size = 10, w = font.widthOfTextAtSize(label, size), [x, y] = v2c(VW / 2 - w / 2, 22);
            pg.drawText(label, { x, y, size, font, color: rgb(0.2, 0.2, 0.2), rotate: degrees(r) });
          }
        });
        meta(out, o, docs.size ? Array.from(docs.values())[0] : null, PDFName);
        return out.save({ useObjectStreams: o.comp !== "none" });
      }
      function meta(out, o, from, PDFName) {
        if (o.strip) {
          out.setTitle(""); out.setAuthor(""); out.setSubject(""); out.setKeywords([]); out.setProducer(""); out.setCreator("");
          const info = out.context.lookup(out.context.trailerInfo.Info);
          if (info) ["Title", "Author", "Subject", "Keywords", "Producer", "Creator", "CreationDate", "ModDate"].forEach((k) => info.delete(PDFName.of(k)));
        } else {
          if (from) { const t = from.getTitle(), a = from.getAuthor(), s = from.getSubject(); if (t) out.setTitle(t); if (a) out.setAuthor(a); if (s) out.setSubject(s); }
          out.setProducer("E.N.O.S."); out.setCreator("E.N.O.S."); out.setModificationDate(new Date());
        }
      }

      // compression agressive : chaque page est rastérisée en JPEG puis le PDF est reconstruit
      async function rasterize(bytes, o, onStep) {
        const L = await A.pdflib(), { PDFDocument, PDFName } = L;
        const src = await A.pdfOpen(bytes), out = await PDFDocument.create({ updateMetadata: false });
        for (let i = 1; i <= src.numPages; i++) {
          onStep && onStep(`Compression ${i}/${src.numPages}…`);
          const page = await src.getPage(i), vp = page.getViewport({ scale: 1 });
          const c = await A.pdfRender(src, i, o.scale), w = document.createElement("canvas");
          w.width = c.width; w.height = c.height;
          const x = w.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w.width, w.height); x.drawImage(c, 0, 0);
          const jpg = await canvasBytes(w, "image/jpeg", o.quality);
          c.width = 0; w.width = 0;
          const img = await out.embedJpg(jpg), pg = out.addPage([vp.width, vp.height]);
          pg.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
          await tick();
        }
        try { src.destroy(); } catch (e) { /* ok */ }
        meta(out, o, null, PDFName);
        return out.save({ useObjectStreams: true });
      }

      const opts = () => ({
        num: $("#pdf-num").checked, numFmt: $("#pdf-numfmt").value,
        wm: $("#pdf-wm").checked, wmText: $("#pdf-wmtxt").value.trim(), wmOp: +$("#pdf-wmop").value / 100,
        strip: $("#pdf-meta").checked, comp: $("#pdf-comp").value, quality: +$("#pdf-q").value / 100, scale: +$("#pdf-scale").value,
      });
      async function make(list, o, label) {
        if (o.wm && !o.wmText) throw new Error("Écris le texte du filigrane (ou décoche-le).");
        if (o.wm && /[^ -ÿ]/.test(o.wmText)) throw new Error("Le filigrane accepte les lettres latines, chiffres et accents (pas d'emoji ni d'alphabet non latin).");
        let bytes = await produce(list, o);
        if (o.comp === "agg") bytes = await rasterize(bytes, o, (t) => setBusy(true, t));
        return bytes;
      }
      const beforeSize = (list) => Array.from(new Set(list.map((p) => p.s))).reduce((a, s) => a + s.bytes.length, 0);
      const outName = (suffix) => {
        let n = $("#pdf-name").value.trim() || "document.pdf";
        n = baseName(n.replace(/\.pdf$/i, "")) ;
        return n + (suffix || "") + ".pdf";
      };
      const report = (before, after, partial) => {
        const d = before ? Math.round((1 - after / before) * 100) : 0;
        return `Enregistré · ${fmt(before)} → ${fmt(after)}` + (partial ? "" : d > 0 ? ` (−${d} %)` : d < 0 ? ` (+${-d} %, plus gros que l'original)` : " (inchangé)");
      };

      $("#pdf-export").onclick = guard(async () => {
        const list = sel.size ? pages.filter((p) => sel.has(p.id)) : pages;
        if (!list.length) throw new Error("Aucune page à exporter.");
        setBusy(true, "Création du PDF…");
        const o = opts(), bytes = await make(list, o);
        await A.save(outName(), "application/pdf", bytes);
        msg(report(beforeSize(list), bytes.length, list.length < pages.length && srcs.length > 1), "ok");
        setBusy(false);
      });
      $("#pdf-extract").onclick = guard(async () => {
        const rg = parseRanges($("#pdf-ranges").value, pages.length), list = [];
        rg.forEach(([a, b]) => { for (let i = a; i <= b; i++) list.push(pages[i - 1]); });
        setBusy(true, "Création du PDF…");
        const bytes = await make(list, opts());
        await A.save(outName("_extrait"), "application/pdf", bytes);
        msg(`Extrait : ${plural(list.length, "page")} · ${fmt(bytes.length)}`, "ok");
        setBusy(false);
      });
      $("#pdf-split").onclick = guard(async () => {
        const rg = parseRanges($("#pdf-ranges").value, pages.length);
        let tot = 0;
        for (let k = 0; k < rg.length; k++) {
          setBusy(true, `Partie ${k + 1}/${rg.length}…`);
          const list = pages.slice(rg[k][0] - 1, rg[k][1]), bytes = await make(list, opts());
          await A.save(outName("_partie" + (k + 1)), "application/pdf", bytes); tot += bytes.length;
          if (k < rg.length - 1) await new Promise((r) => setTimeout(r, 350));
        }
        msg(`${plural(rg.length, "fichier")} enregistré${rg.length > 1 ? "s" : ""} (${fmt(tot)}).`, "ok");
        setBusy(false);
      });

      // ---------------------------------------------------------------- petites options
      const show = (cb, box) => { const f = () => ($(box).hidden = !($(cb).checked)); $(cb).onchange = f; f(); };
      show("#pdf-num", "#pdf-num-o"); show("#pdf-wm", "#pdf-wm-o");
      $("#pdf-comp").onchange = () => ($("#pdf-agg-o").hidden = $("#pdf-comp").value !== "agg");
      $("#pdf-wmop").oninput = () => ($("#pdf-wmop-v").textContent = $("#pdf-wmop").value + " %");
      $("#pdf-q").oninput = () => ($("#pdf-q-v").textContent = $("#pdf-q").value + " %");
      $("#pdf-name").oninput = () => (nameEdited = true);
    },
  });
})();
