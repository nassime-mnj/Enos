"use strict";
// NETTOYEUR DE STOCKAGE : analyse la galerie du téléphone (côté Java : GalleryScan.java) et propose de supprimer photos floues, doublons,
// vieilles captures d'écran et grosses vidéos. Rien n'est supprimé sans la confirmation de la boîte de dialogue système d'Android.
// Les fonctions pures (regroupement, meilleur choix, seuils) sont exposées dans window.ENOS.cleanerLib.
(() => {
  const E = window.ENOS;
  const DAY = 86400;

  // ------------------------------------------------------------------ fonctions pures
  const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
  const isHash = (h) => typeof h === "string" && /^[0-9a-f]{16}$/i.test(h);
  // distance de Hamming entre deux dHash hexadécimaux de 16 chiffres (64 bits) ; Infinity si invalide
  const hamming = (a, b) => {
    if (!isHash(a) || !isHash(b)) return Infinity;
    let d = 0;
    for (let i = 0; i < 16; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
    return d;
  };
  const popcount = (h) => { let n = 0; for (let i = 0; i < 16; i++) n += POP[parseInt(h[i], 16)]; return n; };
  const lowInfo = (h) => { const p = popcount(h); return p < 6 || p > 58; };      // image presque unie : l'empreinte ne distingue rien
  const ratio = (it) => (it.w > 0 && it.h > 0 ? it.w / it.h : 0);
  const similar = (a, b, max) => {
    const d = hamming(a.dhash, b.dhash);
    if (d > max) return false;
    if (lowInfo(a.dhash) || lowInfo(b.dhash)) return d === 0 && a.size === b.size;
    const ra = ratio(a), rb = ratio(b);
    return !(ra && rb && Math.abs(ra - rb) / Math.max(ra, rb) > 0.12);                // formats très différents : pas des doublons
  };

  // meilleur d'un groupe : plus grande résolution, puis plus nette, puis plus lourde, puis plus ancienne, puis id (déterministe)
  const better = (a, b) => {
    const pa = (a.w || 0) * (a.h || 0), pb = (b.w || 0) * (b.h || 0);
    if (pa !== pb) return pa > pb;
    const ba = a.blur == null ? -1 : a.blur, bb = b.blur == null ? -1 : b.blur;
    if (ba !== bb) return ba > bb;
    if (a.size !== b.size) return a.size > b.size;
    if (a.date !== b.date) return a.date < b.date;
    return String(a.id) < String(b.id);
  };
  const pickBest = (group) => group.reduce((m, x) => (better(x, m) ? x : m), group[0]);

  // groupes de doublons (union-find) : images dont le dHash est à <= maxDist bits. Les bandes (principe des tiroirs) évitent le O(n²).
  // -> [{ items:[…], best, exact }] triés par espace récupérable décroissant
  const groupDuplicates = (items, maxDist) => {
    maxDist = Math.max(0, Math.min(32, maxDist | 0));
    const imgs = items.filter((x) => x && x.kind !== "video" && isHash(x.dhash));
    const parent = imgs.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
    const bands = Math.min(maxDist + 1, 16), per = 16 / bands;                        // nibbles par bande (64 bits = 16 nibbles)
    if (maxDist + 1 > 16) {
      for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) if (similar(imgs[i], imgs[j], maxDist)) union(i, j);
    } else {
      for (let b = 0; b < bands; b++) {
        const lo = Math.floor(b * per), hi = Math.floor((b + 1) * per), bucket = new Map();
        imgs.forEach((x, i) => { const k = x.dhash.slice(lo, hi).toLowerCase(); (bucket.get(k) || bucket.set(k, []).get(k)).push(i); });
        bucket.forEach((ix) => { for (let i = 0; i < ix.length; i++) for (let j = i + 1; j < ix.length; j++) if (similar(imgs[ix[i]], imgs[ix[j]], maxDist)) union(ix[i], ix[j]); });
      }
    }
    const groups = new Map();
    imgs.forEach((x, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)).push(x); });
    const out = [];
    groups.forEach((g) => {
      if (g.length < 2) return;
      const best = pickBest(g), rest = g.filter((x) => x !== best);
      out.push({ items: g, best, rest, exact: g.every((x) => x.dhash.toLowerCase() === best.dhash.toLowerCase() && x.size === best.size), space: rest.reduce((s, x) => s + (x.size || 0), 0) });
    });
    return out.sort((a, b) => b.space - a.space || String(a.best.id).localeCompare(String(b.best.id)));
  };

  // netteté (variance du laplacien sur miniature 256 px) -> "floue" | "limite" | "nette" | "inconnue"
  const BLUR_DEF = { blur: 60, limit: 120 };
  const blurClass = (score, th) => {
    th = th || BLUR_DEF;
    if (typeof score !== "number" || !isFinite(score)) return "inconnue";
    return score < th.blur ? "floue" : score < th.limit ? "limite" : "nette";
  };
  const ageDays = (date, now) => Math.max(0, Math.floor(((now == null ? Date.now() / 1000 : now) - date) / DAY));

  // catégories à partir de la liste complète
  const categorize = (items, o) => {
    o = Object.assign({ th: BLUR_DEF, includeLimit: false, dup: 6, shotDays: 30, bigBytes: 100 * 1048576, now: Date.now() / 1000 }, o || {});
    const imgs = items.filter((x) => x.kind !== "video");
    const blurry = imgs.filter((x) => { const c = blurClass(x.blur, o.th); return c === "floue" || (o.includeLimit && c === "limite"); }).sort((a, b) => a.blur - b.blur);
    const dups = groupDuplicates(items, o.dup);
    const shots = imgs.filter((x) => x.isScreenshot && x.date && ageDays(x.date, o.now) >= o.shotDays).sort((a, b) => a.date - b.date);
    const big = items.filter((x) => x.kind === "video" && x.size >= o.bigBytes).sort((a, b) => b.size - a.size);
    const sum = (l) => l.reduce((s, x) => s + (x.size || 0), 0);
    return { blurry, dups, shots, big, space: { blurry: sum(blurry), dups: dups.reduce((s, g) => s + g.space, 0), shots: sum(shots), big: sum(big) } };
  };

  // sélection de la suppression : union des clés sans doublon, jamais un groupe de doublons entièrement supprimé
  const itemKey = (x) => x.uri;
  const MAX_DELETE = 500;

  E.cleanerLib = { hamming, groupDuplicates, pickBest, blurClass, ageDays, categorize, BLUR_DEF, lowInfo, MAX_DELETE };

  // ------------------------------------------------------------------ interface
  const fmt = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2).replace(".", ",") + " Go" : n >= 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " Mo" : n >= 1024 ? Math.round(n / 1024) + " Ko" : (n || 0) + " o");
  const fdate = (t) => (t ? new Date(t * 1000).toLocaleDateString("fr-FR") : "?");
  const SAFE_URI = /^content:\/\/media\/external(?:_primary)?\/(?:images|video)\/media\/\d+$/;
  const SAFE_THUMB = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/;
  const CATS = [
    { id: "blurry", t: "Photos floues", icon: "🌫", help: "Netteté insuffisante : mouvement ou mise au point ratée." },
    { id: "dups", t: "Doublons", icon: "👯", help: "Images identiques ou quasi identiques. Le meilleur exemplaire de chaque groupe est conservé." },
    { id: "shots", t: "Captures d'écran", icon: "📱", help: "Captures d'écran anciennes." },
    { id: "big", t: "Gros fichiers", icon: "🎞", help: "Vidéos volumineuses." },
  ];

  E.suite.register({
    id: "cleaner", group: "scan", title: "Nettoyeur de stockage", sub: "Floues, doublons, captures, vidéos",
    icon: '<path d="M4 20h16M6 20l2-9h8l2 9M10 11V5a2 2 0 0 1 4 0v6"/>',
    build(el, A) {
      const esc = E.esc, N = E.native;
      const prefs = Object.assign({ blur: 60, includeLimit: false, dup: 6, shotDays: 30, bigMb: 100 }, (() => { try { return E.store.get("cleaner", {}); } catch (e) { return {}; } })());
      const savePrefs = () => { try { E.store.set("cleaner", prefs); } catch (e) { /* stockage indisponible */ } };
      const S = { items: [], byKey: new Map(), sel: new Set(), scanning: false, scanned: false, perm: null, progress: null, view: "home", err: "", msg: "", cat: null, more: 60, busy: false };
      const cb = new Map();
      let seq = 7000000, thumbs = new Map(), thumbQ = 0;

      // ---- pont natif (lecture paresseuse : un faux pont de test peut être injecté à tout moment)
      const B = () => (N.available && window.Enos && typeof window.Enos.galleryScan === "function" ? window.Enos : null);
      const hook = () => {
        const cur = E.native._cb;
        if (cur && cur._cln) return;
        const w = (id, evt, p) => { const h = cb.get(id); if (h) h(evt, p); else if (cur) cur(id, evt, p); };
        w._cln = true; E.native._cb = w;
      };
      const call = (start, onEvt) => { hook(); const id = ++seq; cb.set(id, (evt, p) => { let j = p; try { j = JSON.parse(p); } catch (e) { /* texte brut */ } if (onEvt(evt, j) === true) cb.delete(id); }); start(id); return id; };
      const th = () => ({ blur: prefs.blur, limit: prefs.blur * 2 });
      const cats = () => categorize(S.items, { th: th(), includeLimit: prefs.includeLimit, dup: prefs.dup, shotDays: prefs.shotDays, bigBytes: prefs.bigMb * 1048576 });

      el.innerHTML = '<div class="card cln" id="cln-root"></div><div class="cln-bar" id="cln-bar" hidden></div>';
      const $ = (s) => el.querySelector(s), root = $("#cln-root"), bar = $("#cln-bar");

      // ---- sélection
      const groupOf = (k) => { const c = cats(); return c.dups.find((g) => g.items.some((x) => itemKey(x) === k)); };
      const toggle = (k) => {
        if (S.sel.has(k)) { S.sel.delete(k); return; }
        const g = groupOf(k);                                              // garde-fou : on ne supprime jamais toutes les copies d'un groupe
        if (g && g.items.every((x) => itemKey(x) === k || S.sel.has(itemKey(x)))) return A.toast("Garde au moins un exemplaire de ce groupe.", "warn");
        S.sel.add(k);
      };
      const selItems = () => [...S.sel].map((k) => S.byKey.get(k)).filter(Boolean);
      const selBytes = () => selItems().reduce((s, x) => s + (x.size || 0), 0);

      // ---- scan
      const baseState = () => { S.items = []; S.byKey = new Map(); S.sel = new Set(); thumbs = new Map(); S.err = ""; S.msg = ""; };
      const addItems = (arr) => (Array.isArray(arr) ? arr : []).forEach((x) => {
        if (!x || typeof x.uri !== "string" || !SAFE_URI.test(x.uri) || S.byKey.has(x.uri)) return;
        const it = { kind: x.kind === "video" ? "video" : "image", id: x.id, uri: x.uri, name: String(x.name || ""), size: +x.size || 0, date: +x.date || 0, folder: String(x.folder || ""), w: +x.w || 0, h: +x.h || 0,
          blur: typeof x.blur === "number" ? x.blur : null, dhash: isHash(x.dhash) ? x.dhash.toLowerCase() : null, isScreenshot: !!x.isScreenshot, duration: +x.duration || 0 };
        S.items.push(it); S.byKey.set(it.uri, it);
      });
      const startScan = () => {
        const b = B(); if (!b || S.scanning) return;
        baseState(); S.scanning = true; S.perm = null; S.progress = { done: 0, total: 0 }; render();
        call((id) => b.galleryPermission(id), (evt, p) => {
          if (evt !== "perm") return false;
          if (!p || !p.granted) { S.scanning = false; S.perm = false; S.progress = null; render(); return true; }
          S.perm = true;
          call((id2) => b.galleryScan(id2), (e2, q) => {
            if (e2 === "head") { S.progress.total = (q && q.total) || 0; render(); }
            else if (e2 === "items") { addItems(q); S.progress.done = S.items.length; renderSoft(); }
            else if (e2 === "progress") { S.progress = { done: q.done || S.items.length, total: q.total || S.progress.total }; renderSoft(); }
            else if (e2 === "end") { S.scanning = false; S.scanned = true; S.progress = null; render(); return true; }
            else if (e2 === "cancelled") { S.scanning = false; S.scanned = S.items.length > 0; S.progress = null; S.msg = "Analyse annulée."; render(); return true; }
            else if (e2 === "error") { S.scanning = false; S.progress = null; S.err = String(q || "Analyse interrompue."); render(); return true; }
            return false;
          });
          return true;
        });
      };
      const cancelScan = () => { const b = B(); if (b && b.galleryCancel) b.galleryCancel(); };

      // ---- suppression : seules des clés du dernier scan sont acceptées (Java revalide de son côté)
      const deleteKeys = (keys) => new Promise((res) => {
        const b = B();
        if (!b) return res({ ok: false, error: "Disponible dans l'application Android." });
        keys = [...new Set(keys)];
        const bad = keys.filter((k) => !S.byKey.has(k) || !SAFE_URI.test(k));
        if (bad.length) return res({ ok: false, error: "Fichier hors de la dernière analyse : refusé.", refused: bad });
        if (!keys.length) return res({ ok: false, error: "Rien à supprimer." });
        if (keys.length > MAX_DELETE) return res({ ok: false, error: "Trop de fichiers à la fois (max " + MAX_DELETE + ")." });
        // jamais toutes les copies d'un groupe
        const c = cats(), set = new Set(keys);
        if (c.dups.some((g) => g.items.every((x) => set.has(itemKey(x))))) return res({ ok: false, error: "Un groupe de doublons serait entièrement supprimé : refusé." });
        call((id) => b.galleryDelete(id, JSON.stringify(keys)), (evt, p) => {
          if (evt !== "deleted") return false;
          res(Object.assign({ requested: keys }, p || { ok: false })); return true;
        });
      });
      const doDelete = async () => {
        if (S.busy || !S.sel.size) return;
        S.busy = true; S.err = ""; S.msg = ""; renderBar();
        const keys = [...S.sel], bytes = selBytes();
        const r = await deleteKeys(keys);
        S.busy = false;
        if (r.ok) {
          const gone = new Set(Array.isArray(r.deleted) && r.deleted.length ? r.deleted : keys);
          let freed = 0; gone.forEach((k) => { const it = S.byKey.get(k); if (it) { freed += it.size; S.byKey.delete(k); } });
          S.items = S.items.filter((x) => !gone.has(x.uri)); gone.forEach((k) => S.sel.delete(k));
          S.msg = gone.size + " fichier(s) supprimé(s) · " + fmt(freed || bytes) + " libérés."; A.toast(S.msg, "ok");
        } else if (r.cancelled) { S.msg = "Suppression annulée : rien n'a été supprimé."; A.toast(S.msg, "warn"); }
        else { S.err = r.error || "Suppression impossible."; A.toast(S.err, "err"); }
        render();
      };
      E.cleaner = { deleteKeys, rerender: () => render(), state: () => ({ selected: [...S.sel], count: S.items.length }) };

      // ---- vignettes (schéma fourni par le natif : galleryThumb -> data:image/jpeg ; sinon pas de vignette)
      const thumbFor = (it) => {
        if (thumbs.has(it.uri)) return thumbs.get(it.uri);
        const b = window.Enos; let u = "";
        try { if (N.available && b && typeof b.galleryThumb === "function") u = String(b.galleryThumb(it.uri) || ""); } catch (e) { u = ""; }
        u = SAFE_THUMB.test(u) ? u : ""; thumbs.set(it.uri, u); return u;
      };
      const loadThumbs = () => {
        clearTimeout(thumbQ);
        const todo = Array.from(root.querySelectorAll("[data-tk]:not([data-done])"));
        const step = () => { const s = todo.shift(); if (!s) return; s.dataset.done = "1"; const it = S.byKey.get(s.dataset.tk); if (it) { const u = thumbFor(it); if (u) s.innerHTML = `<img alt="" src="${u}">`; } thumbQ = setTimeout(step, 0); };
        thumbQ = setTimeout(step, 0);
      };

      // ---- rendu
      const ph = (it) => (it.kind === "video" ? "🎞" : "🖼");
      const cell = (it, extra) => `<div class="cln-item ${S.sel.has(it.uri) ? "on" : ""}" data-k="${esc(it.uri)}" role="checkbox" aria-checked="${S.sel.has(it.uri)}" tabindex="0" aria-label="${esc(it.name)}">
        <span class="cln-th" data-tk="${esc(it.uri)}">${ph(it)}</span><span class="cln-ck">✓</span>${extra || ""}<b>${esc(it.name)}</b><small>${fmt(it.size)}${it.w ? " · " + it.w + "×" + it.h : ""}</small>
        <button class="cln-i" data-info="${esc(it.uri)}" aria-label="Détails de ${esc(it.name)}">ⓘ</button></div>`;
      function renderSoft() { const p = $("#cln-prog"); if (p && S.progress) { p.textContent = S.progress.done + (S.progress.total ? " / " + S.progress.total : "") + " fichiers analysés…"; const f = $("#cln-pbar"); if (f && S.progress.total) f.style.width = Math.min(100, Math.round(100 * S.progress.done / S.progress.total)) + "%"; } }
      function renderBar() {
        const n = S.sel.size;
        bar.hidden = !n && !S.busy;
        bar.innerHTML = `<button class="btn pri wide" id="cln-del" ${S.busy ? "disabled" : ""}>${S.busy ? "CONFIRME DANS LA FENÊTRE ANDROID…" : "SUPPRIMER (" + n + ") · " + esc(fmt(selBytes()))}</button>`;
      }
      function render() {
        renderBar();
        if (!B()) {
          root.innerHTML = `<h3>Nettoyeur de stockage</h3><p class="muted" id="cln-na">Disponible dans l'application Android.</p><p class="muted">Il analyse la galerie du téléphone pour retrouver les photos floues, les doublons, les vieilles captures d'écran et les grosses vidéos. Tout reste sur l'appareil.</p>`;
          return;
        }
        if (S.view === "cat") return renderCat();
        const c = cats(), has = S.scanned || S.items.length;
        root.innerHTML = `<h3>Nettoyeur de stockage</h3>
          <p class="muted">Analyse locale de ta galerie. Rien n'est supprimé sans ta confirmation dans la fenêtre du système.</p>
          ${S.perm === false ? '<p class="err" id="cln-perm" role="alert">Accès aux photos refusé. Autorise-le dans Réglages Android → Applications → E.N.O.S. → Autorisations → Photos et vidéos, puis relance l\'analyse.</p>' : ""}
          ${S.err ? `<p class="err" id="cln-err" role="alert">${esc(S.err)}</p>` : ""}${S.msg ? `<p class="ok" id="cln-msg" role="status">${esc(S.msg)}</p>` : ""}
          ${S.scanning ? `<div class="cln-pw"><div class="cln-pbar"><i id="cln-pbar" style="width:3%"></i></div><p class="muted" id="cln-prog">Analyse…</p><button class="btn wide" id="cln-cancel">ANNULER L'ANALYSE</button></div>`
            : `<button class="btn pri wide" id="cln-scan">${has ? "ANALYSER À NOUVEAU" : "ANALYSER LA GALERIE"}</button>`}
          ${has ? `<div class="cln-cats" id="cln-cats">${CATS.map((k) => { const n = k.id === "dups" ? c.dups.reduce((s, g) => s + g.rest.length, 0) : c[k.id].length;
            return `<button class="cln-cat" data-cat="${k.id}" id="cln-cat-${k.id}" ${n ? "" : "disabled"}><span class="cln-ic">${k.icon}</span><b>${k.t}</b><span class="cln-count">${n}</span><small class="cln-space">${n ? fmt(c.space[k.id]) + " récupérables" : "Rien à nettoyer"}</small></button>`; }).join("")}</div>
            <p class="muted" id="cln-total">${S.items.length} fichiers analysés.</p>` : ""}
          <details class="cln-set"><summary>Réglages</summary>
            <label class="muted" for="cln-s-blur">Sensibilité au flou</label><select id="cln-s-blur">${[[40, "Prudente (très floues seulement)"], [60, "Normale"], [90, "Large"]].map(([v, t]) => `<option value="${v}" ${prefs.blur === v ? "selected" : ""}>${t}</option>`).join("")}</select>
            <label class="muted" for="cln-s-dup">Tolérance des doublons</label><select id="cln-s-dup">${[[0, "Identiques seulement"], [4, "Stricte"], [6, "Normale"], [10, "Large"]].map(([v, t]) => `<option value="${v}" ${prefs.dup === v ? "selected" : ""}>${t}</option>`).join("")}</select>
            <label class="muted" for="cln-s-shot">Captures plus vieilles que</label><select id="cln-s-shot">${[7, 30, 90, 180].map((v) => `<option value="${v}" ${prefs.shotDays === v ? "selected" : ""}>${v} jours</option>`).join("")}</select>
            <label class="muted" for="cln-s-big">Vidéos plus grosses que</label><select id="cln-s-big">${[50, 100, 250, 500].map((v) => `<option value="${v}" ${prefs.bigMb === v ? "selected" : ""}>${v} Mo</option>`).join("")}</select>
            <label class="chip2"><input type="checkbox" id="cln-s-lim" ${prefs.includeLimit ? "checked" : ""}> Inclure les photos « limite »</label></details>`;
        const sc = $("#cln-scan"); if (sc) sc.onclick = startScan;
        const cn = $("#cln-cancel"); if (cn) cn.onclick = cancelScan;
        root.querySelectorAll("[data-cat]").forEach((b) => { b.onclick = () => { S.view = "cat"; S.cat = b.dataset.cat; S.more = 60; render(); scrollTo(0, 0); }; });
        const bind = (id, key, num) => { const x = $(id); if (x) x.onchange = () => { prefs[key] = num ? +x.value : x.checked; savePrefs(); render(); }; };
        bind("#cln-s-blur", "blur", 1); bind("#cln-s-dup", "dup", 1); bind("#cln-s-shot", "shotDays", 1); bind("#cln-s-big", "bigMb", 1);
        const l = $("#cln-s-lim"); if (l) l.onchange = () => { prefs.includeLimit = l.checked; savePrefs(); render(); };
        if (S.scanning) renderSoft();
      }
      function renderCat() {
        const c = cats(), k = CATS.find((x) => x.id === S.cat) || CATS[0];
        let body = "", list = [];
        if (k.id === "dups") {
          let shown = 0;
          body = c.dups.map((g, gi) => {
            if (shown >= S.more) return "";
            shown += g.items.length;
            return `<div class="cln-grp" data-g="${gi}"><p class="muted">Groupe ${gi + 1} · ${g.exact ? "identiques" : "quasi identiques"} · ${fmt(g.space)} récupérables</p><div class="cln-grid">${g.items.map((it) => cell(it, it === g.best ? '<span class="cln-keep">À GARDER</span>' : "")).join("")}</div></div>`;
          }).join("");
          list = c.dups.flatMap((g) => g.rest);
        } else {
          list = c[k.id];
          const extra = (it) => (k.id === "blurry" ? `<span class="cln-tag">${esc(blurClass(it.blur, th()))} · ${Math.round(it.blur)}</span>` : k.id === "shots" ? `<span class="cln-tag">${ageDays(it.date)} j</span>` : it.duration ? `<span class="cln-tag">${Math.round(it.duration / 60)} min</span>` : "");
          body = `<div class="cln-grid">${list.slice(0, S.more).map((it) => cell(it, extra(it))).join("")}</div>`;
        }
        const total = k.id === "dups" ? c.dups.reduce((s, g) => s + g.items.length, 0) : list.length;
        root.innerHTML = `<div class="row"><button class="btn" id="cln-back">◂ RETOUR</button></div><h3>${k.icon} ${k.t} <span class="sp">${list.length} · ${fmt(c.space[k.id])}</span></h3><p class="muted">${k.help}</p>
          ${S.err ? `<p class="err" role="alert">${esc(S.err)}</p>` : ""}
          <div class="row">${k.id === "dups" ? '<button class="btn pri" id="cln-keepbest">GARDER LE MEILLEUR · SÉLECTIONNER LE RESTE</button>' : '<button class="btn" id="cln-selall">TOUT SÉLECTIONNER</button>'}<button class="btn" id="cln-selnone">TOUT DÉSÉLECTIONNER</button></div>
          ${body || '<p class="muted">Rien à afficher.</p>'}${total > S.more ? '<button class="btn wide" id="cln-more">VOIR PLUS</button>' : ""}`;
        $("#cln-back").onclick = () => { S.view = "home"; render(); };
        $("#cln-selnone").onclick = () => { list.forEach((x) => S.sel.delete(x.uri)); if (k.id === "dups") c.dups.forEach((g) => g.items.forEach((x) => S.sel.delete(x.uri))); render(); };
        const sa = $("#cln-selall"); if (sa) sa.onclick = () => { list.forEach((x) => S.sel.add(x.uri)); render(); };
        const kb = $("#cln-keepbest"); if (kb) kb.onclick = () => { c.dups.forEach((g) => g.rest.forEach((x) => S.sel.add(x.uri))); render(); };
        const mo = $("#cln-more"); if (mo) mo.onclick = () => { S.more += 60; render(); };
        loadThumbs();
      }

      el.addEventListener("click", (e) => {
        const info = e.target.closest("[data-info]");
        if (info) { e.stopPropagation(); return showInfo(S.byKey.get(info.dataset.info)); }
        const it = e.target.closest(".cln-item");
        if (it && root.contains(it)) { toggle(it.dataset.k); it.classList.toggle("on", S.sel.has(it.dataset.k)); it.setAttribute("aria-checked", S.sel.has(it.dataset.k)); renderBar(); if (S.cat === "dups" && S.view === "cat") { /* l'état d'un seul item suffit */ } return; }
        if (e.target.closest("#cln-del")) doDelete();
      });
      el.addEventListener("keydown", (e) => { const it = e.target.closest && e.target.closest(".cln-item"); if (it && (e.key === " " || e.key === "Enter")) { e.preventDefault(); it.click(); } });

      function showInfo(it) {
        if (!it) return;
        const old = document.getElementById("cln-info"); if (old) old.remove();
        const u = thumbFor(it), c = blurClass(it.blur, th());
        const d = A.h(`<div class="cln-info" id="cln-info" role="dialog" aria-modal="true"><div class="cln-ib">${u ? `<img alt="" src="${u}">` : `<div class="cln-ph">${ph(it)}</div>`}
          <p><b>${esc(it.name)}</b></p><p class="muted">${esc(it.folder)}<br>${fmt(it.size)}${it.w ? " · " + it.w + "×" + it.h : ""} · ${fdate(it.date)}${it.blur != null ? "<br>Netteté : " + Math.round(it.blur) + " (" + c + ")" : ""}${it.isScreenshot ? "<br>Capture d'écran" : ""}</p>
          <button class="btn pri wide" id="cln-iclose">FERMER</button></div></div>`);
        document.body.appendChild(d); d.querySelector("#cln-iclose").onclick = () => d.remove(); d.onclick = (e) => { if (e.target === d) d.remove(); };
      }
      render();
    },
    onShow() { if (E.cleaner && E.cleaner.rerender) E.cleaner.rerender(); },
  });
})();
