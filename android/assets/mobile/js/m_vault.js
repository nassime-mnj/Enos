"use strict";
// COFFRE-FORT HORS-LIGNE : documents / médias / téléchargements chiffrés LOCALEMENT (WebCrypto), rangés dans IndexedDB.
//  - phrase secrète -> clé : PBKDF2-SHA256 (sel aléatoire 16 o, >= 310 000 itérations) -> AES-256-GCM (clé NON extractable, gardée en mémoire seulement) ;
//  - chaque fichier : blocs de 4 Mo, IV aléatoire de 12 o par bloc, position du bloc liée au chiffrement (données additionnelles) ;
//  - nom, type, taille et vignette sont chiffrés aussi ; un « vérificateur » chiffré détecte une mauvaise phrase sans rien révéler ;
//  - aucune clé, aucune phrase, aucun octet en clair n'est écrit : ni localStorage, ni IndexedDB.
// Le cœur crypto est exposé dans window.ENOS.vaultLib (testable sans interface).
(() => {
  const E = window.ENOS;
  const MIN_ITER = 310000, ITER = 400000, CHUNK = 4 * 1024 * 1024, MIN_PHRASE = 10;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
  const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
  const concat = (parts, total) => { const o = new Uint8Array(total); let p = 0; parts.forEach((x) => { o.set(x, p); p += x.length; }); return o; };

  // ------------------------------------------------------------------ primitives crypto
  async function deriveKey(phrase, salt, iter) {
    if (!(iter >= MIN_ITER)) throw new Error("itérations insuffisantes");
    const base = await crypto.subtle.importKey("raw", enc.encode(String(phrase).normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  // scelle : IV(12) || chiffré+étiquette ; `aad` lie le chiffré à son emplacement (fichier, bloc, rôle)
  async function seal(key, bytes, aad) {
    const iv = rnd(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, bytes));
    return concat([iv, ct], 12 + ct.length);
  }
  async function unseal(key, blob, aad) {
    const b = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12), additionalData: enc.encode(aad) }, key, b.subarray(12)));
  }
  const VERIFY_TEXT = "ENOS-VAULT-v1";
  const makeVerifier = (key) => seal(key, enc.encode(VERIFY_TEXT), "verifier");
  const checkVerifier = async (key, v) => { try { return dec.decode(await unseal(key, v, "verifier")) === VERIFY_TEXT; } catch (e) { return false; } };
  const sealJson = (key, o, aad) => seal(key, enc.encode(JSON.stringify(o)), aad);
  const openJson = async (key, b, aad) => JSON.parse(dec.decode(await unseal(key, b, aad)));
  // blocs de 4 Mo : [IV||chiffré, …] ; aad = id|i|n (réordonner, tronquer ou mélanger deux fichiers est détecté)
  async function encryptChunks(key, bytes, id, size, onChunk) {
    const cs = size || CHUNK, n = Math.max(1, Math.ceil(bytes.length / cs)), out = [];
    for (let i = 0; i < n; i++) {
      const s = await seal(key, bytes.subarray(i * cs, Math.min(bytes.length, (i + 1) * cs)), id + "|" + i + "|" + n);
      if (onChunk) await onChunk(i, s, n); else out.push(s);
    }
    return out;
  }
  async function decryptChunks(key, chunks, id) {
    const n = chunks.length, parts = []; let total = 0;
    for (let i = 0; i < n; i++) { const p = await unseal(key, chunks[i], id + "|" + i + "|" + n); parts.push(p); total += p.length; }
    return concat(parts, total);
  }
  // délai croissant après 3 échecs : 5 s, 10 s, 20 s … plafonné à 1 h
  const delayFor = (fails) => (fails < 3 ? 0 : Math.min(3600, 5 * Math.pow(2, fails - 3)) * 1000);

  // ------------------------------------------------------------------ stockage IndexedDB
  const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("abandon")); });

  function createVault(dbName) {
    dbName = dbName || "enos-vault";
    let db = null, key = null, cfg = null;
    const V = { get unlocked() { return !!key; }, dbName };

    const openDb = () => db ? Promise.resolve(db) : new Promise((res, rej) => {
      const r = indexedDB.open(dbName, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("meta");
        d.createObjectStore("files", { keyPath: "id" });
        d.createObjectStore("chunks", { keyPath: ["fid", "i"] });
      };
      r.onsuccess = () => { db = r.result; db.onversionchange = () => { db.close(); db = null; }; res(db); };
      r.onerror = () => rej(r.error);
    });
    const store = async (name, mode) => (await openDb()).transaction(name, mode).objectStore(name);
    const getCfg = async () => (cfg = (await rq((await store("meta", "readonly")).get("cfg"))) || null);
    const putCfg = async (c) => { cfg = c; const t = (await openDb()).transaction("meta", "readwrite"); t.objectStore("meta").put(c, "cfg"); await done(t); };
    V.exists = async () => !!(await getCfg());
    V.config = async () => { const c = await getCfg(); return c && { autolock: c.autolock, fails: c.fails || 0, lockUntil: c.lockUntil || 0, iter: c.iter }; };

    V.create = async (phrase, autolock) => {
      if (typeof phrase !== "string" || phrase.length < MIN_PHRASE) throw new Error("La phrase doit contenir au moins " + MIN_PHRASE + " caractères.");
      if (await getCfg()) throw new Error("Un coffre existe déjà.");
      const salt = rnd(16), k = await deriveKey(phrase, salt, ITER);
      await putCfg({ v: 1, gen: 0, salt, iter: ITER, verifier: await makeVerifier(k), fails: 0, lockUntil: 0, autolock: autolock || 120 });
      key = k;
    };
    // -> {ok:true} | {ok:false, wait:ms} (délai en cours) | {ok:false, fails}
    V.unlock = async (phrase) => {
      const c = await getCfg();
      if (!c) throw new Error("Aucun coffre.");
      const now = Date.now();
      if (c.lockUntil && now < c.lockUntil) return { ok: false, wait: c.lockUntil - now, fails: c.fails || 0 };
      let k = null;
      try { k = await deriveKey(phrase, c.salt, c.iter); } catch (e) { k = null; }
      if (k && (await checkVerifier(k, c.verifier))) {
        await putCfg(Object.assign({}, c, { fails: 0, lockUntil: 0 }));
        key = k;
        await purgeOrphans();
        return { ok: true };
      }
      const fails = (c.fails || 0) + 1, wait = delayFor(fails);
      await putCfg(Object.assign({}, c, { fails, lockUntil: wait ? Date.now() + wait : 0 }));
      return { ok: false, fails, wait };
    };
    V.lock = () => { key = null; };
    V.setAutolock = async (sec) => { const c = await getCfg(); if (c) await putCfg(Object.assign({}, c, { autolock: sec })); };
    const need = () => { if (!key) throw new Error("Coffre verrouillé."); return key; };

    // supprime les restes d'un changement de phrase interrompu (enregistrements d'une autre génération)
    async function purgeOrphans() {
      const d = await openDb(), files = await rq(d.transaction("files").objectStore("files").getAll());
      const good = new Set(files.filter((f) => f.gen === cfg.gen).map((f) => f.id));
      const t = d.transaction(["files", "chunks"], "readwrite");
      files.filter((f) => f.gen !== cfg.gen).forEach((f) => t.objectStore("files").delete(f.id));
      const cur = t.objectStore("chunks").openKeyCursor();
      cur.onsuccess = () => { const c = cur.result; if (c) { if (!good.has(c.key[0])) t.objectStore("chunks").delete(c.key); c.continue(); } };
      await done(t);
    }

    // data: Uint8Array ; thumb: Uint8Array|null (JPEG réduit) -> id
    V.add = async (name, type, data, thumb, onProgress) => {
      const k = need(), id = hex(rnd(12));
      await encryptChunks(k, data, id, CHUNK, async (i, sealed, n) => {
        const t = (await openDb()).transaction("chunks", "readwrite"); t.objectStore("chunks").put({ fid: id, i, d: sealed }); await done(t);
        if (onProgress) onProgress((i + 1) / n);
      });
      const n = Math.max(1, Math.ceil(data.length / CHUNK));
      const rec = { id, gen: cfg.gen, n, m: await sealJson(k, { name, type, size: data.length, added: Date.now() }, id + "|meta"), t: thumb ? await seal(k, thumb, id + "|thumb") : null };
      const t = (await openDb()).transaction("files", "readwrite"); t.objectStore("files").put(rec); await done(t);
      return id;
    };
    V.list = async () => {
      const k = need(), recs = await rq((await store("files", "readonly")).getAll()), out = [];
      for (const r of recs) {
        if (r.gen !== cfg.gen) continue;
        try { out.push(Object.assign(await openJson(k, r.m, r.id + "|meta"), { id: r.id, hasThumb: !!r.t })); } catch (e) { /* enregistrement illisible : ignoré */ }
      }
      return out.sort((a, b) => b.added - a.added);
    };
    V.thumb = async (id) => { const k = need(), r = await rq((await store("files", "readonly")).get(id)); return r && r.t ? unseal(k, r.t, id + "|thumb") : null; };
    V.read = async (id) => {
      const k = need(), d = await openDb(), r = await rq(d.transaction("files").objectStore("files").get(id));
      if (!r) throw new Error("Fichier introuvable.");
      const chunks = [];
      for (let i = 0; i < r.n; i++) { const c = await rq(d.transaction("chunks").objectStore("chunks").get([id, i])); if (!c) throw new Error("Données incomplètes."); chunks.push(c.d); }
      return decryptChunks(k, chunks, id);
    };
    V.rename = async (id, name) => {
      const k = need(), s = await store("files", "readwrite"), r = await rq(s.get(id));
      if (!r) throw new Error("Fichier introuvable.");
      const m = await openJson(k, r.m, id + "|meta"); m.name = name;
      r.m = await sealJson(k, m, id + "|meta");
      const t = (await openDb()).transaction("files", "readwrite"); t.objectStore("files").put(r); await done(t);
    };
    V.remove = async (id) => {
      need();
      const d = await openDb(), t = d.transaction(["files", "chunks"], "readwrite");
      t.objectStore("files").delete(id);
      t.objectStore("chunks").delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
      await done(t);
    };
    // change la phrase : tout est rechiffré sous une NOUVELLE génération, puis une seule transaction bascule (rien n'est perdu si ça s'interrompt)
    V.changePhrase = async (oldPhrase, newPhrase, onProgress) => {
      if (typeof newPhrase !== "string" || newPhrase.length < MIN_PHRASE) throw new Error("La nouvelle phrase doit contenir au moins " + MIN_PHRASE + " caractères.");
      const old = need(), c = await getCfg();
      const chk = await deriveKey(oldPhrase, c.salt, c.iter);
      if (!(await checkVerifier(chk, c.verifier))) return { ok: false, error: "Phrase actuelle incorrecte." };
      const salt = rnd(16), nk = await deriveKey(newPhrase, salt, ITER), gen = c.gen + 1, d = await openDb();
      const recs = (await rq(d.transaction("files").objectStore("files").getAll())).filter((f) => f.gen === c.gen), oldIds = [];
      let n = 0;
      for (const r of recs) {
        const nid = hex(rnd(12)), meta = await openJson(old, r.m, r.id + "|meta");
        for (let i = 0; i < r.n; i++) {
          const ch = await rq(d.transaction("chunks").objectStore("chunks").get([r.id, i]));
          const plain = await unseal(old, ch.d, r.id + "|" + i + "|" + r.n), sealed = await seal(nk, plain, nid + "|" + i + "|" + r.n);
          const t = d.transaction("chunks", "readwrite"); t.objectStore("chunks").put({ fid: nid, i, d: sealed }); await done(t);
        }
        const nr = { id: nid, gen, n: r.n, m: await sealJson(nk, meta, nid + "|meta"), t: r.t ? await seal(nk, await unseal(old, r.t, r.id + "|thumb"), nid + "|thumb") : null };
        const t = d.transaction("files", "readwrite"); t.objectStore("files").put(nr); await done(t);
        oldIds.push(r.id);
        if (onProgress) onProgress(++n / recs.length);
      }
      const nc = Object.assign({}, c, { gen, salt, iter: ITER, verifier: await makeVerifier(nk), fails: 0, lockUntil: 0 });
      const t = d.transaction(["meta", "files", "chunks"], "readwrite");
      t.objectStore("meta").put(nc, "cfg");
      oldIds.forEach((id) => { t.objectStore("files").delete(id); t.objectStore("chunks").delete(IDBKeyRange.bound([id, 0], [id, Infinity])); });
      await done(t);
      cfg = nc; key = nk;
      return { ok: true };
    };
    // effacement total : tout est supprimé, le coffre n'existe plus
    V.wipe = async () => {
      key = null; cfg = null;
      try {
        const d = await openDb(), t = d.transaction(["meta", "files", "chunks"], "readwrite");
        ["meta", "files", "chunks"].forEach((s) => t.objectStore(s).clear());
        await done(t);
      } catch (e) { /* on tente quand même la suppression de la base */ }
      if (db) { db.close(); db = null; }
      await new Promise((res) => { const r = indexedDB.deleteDatabase(dbName); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    };
    return V;
  }

  E.vaultLib = { MIN_ITER, ITER, CHUNK, MIN_PHRASE, deriveKey, seal, unseal, makeVerifier, checkVerifier, encryptChunks, decryptChunks, delayFor, createVault, autoLockMs: null };

  // ------------------------------------------------------------------ interface
  const fmt = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " Mo" : n >= 1024 ? Math.round(n / 1024) + " Ko" : n + " o");
  const kindOf = (t, n) => (/^image\//.test(t) ? "img" : /pdf/.test(t) || /\.pdf$/i.test(n) ? "pdf" : /^video\//.test(t) ? "vid" : /^audio\//.test(t) ? "aud" : /^text\/|json|xml/.test(t) ? "txt" : "file");
  const GLYPH = { img: "🖼", pdf: "📄", vid: "🎞", aud: "🎵", txt: "📝", file: "📁" };

  E.suite.register({
    id: "vault", group: "scan", title: "Coffre-fort", sub: "Fichiers chiffrés, hors-ligne",
    icon: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    build(el, A) {
      const V = createVault("enos-vault"), esc = E.esc, $ = (s) => el.querySelector(s);
      let urls = [], timer = 0, busy = false, view = null, waitTimer = 0;
      const lockMs = (c) => E.vaultLib.autoLockMs || ((c && c.autolock) || 120) * 1000;
      const revokeAll = () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; };
      const mkUrl = (bytes, type) => { const u = URL.createObjectURL(new Blob([bytes], { type: type || "application/octet-stream" })); urls.push(u); return u; };
      const setErr = (m) => { const e = $("#vlt-err"); if (e) { e.hidden = !m; e.textContent = m || ""; } };
      el.innerHTML = '<div class="card vlt" id="vlt-root"></div>';
      const root = $("#vlt-root");

      // ---- verrouillage
      const lock = (why) => {
        const was = V.unlocked;
        V.lock(); clearTimeout(timer); timer = 0; closeView(); revokeAll();
        if (was) { show(); if (why) A.toast(why, "warn"); } else show();
      };
      const touch = async () => {
        clearTimeout(timer);
        if (!V.unlocked) return;
        const c = await V.config().catch(() => null);
        clearTimeout(timer);
        if (V.unlocked) timer = setTimeout(() => lock("Coffre verrouillé (inactivité)."), lockMs(c));
      };
      const hidden = () => document.hidden || document.visibilityState === "hidden";
      document.addEventListener("visibilitychange", () => { if (hidden() && V.unlocked) lock("Coffre verrouillé."); });
      window.addEventListener("pagehide", () => { if (V.unlocked) lock(); });
      ["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => el.addEventListener(ev, () => { if (V.unlocked) touch(); }, { capture: true, passive: true }));

      // ---- écrans
      async function show() {
        clearInterval(waitTimer);
        if (!(await V.exists())) return showCreate();
        if (!V.unlocked) return showLocked();
        return showOpen();
      }
      function showCreate() {
        root.innerHTML = `<h3>Coffre-fort</h3>
          <p class="muted">Cache tes documents, photos et fichiers sensibles dans un espace chiffré sur ce téléphone. Rien ne quitte l'appareil.</p>
          <p class="vlt-warn"><b>Attention :</b> si tu perds la phrase secrète, <b>rien n'est récupérable</b>. Personne ne peut la retrouver, ni le contenu du coffre.</p>
          <input type="password" id="vlt-phrase" autocomplete="new-password" placeholder="Phrase secrète (10 caractères minimum)" aria-label="Phrase secrète">
          <input type="password" id="vlt-phrase2" autocomplete="new-password" placeholder="Confirme la phrase" aria-label="Confirmation de la phrase" style="margin-top:8px">
          <label class="vlt-ack"><input type="checkbox" id="vlt-ack"> J'ai compris : sans la phrase, mes fichiers sont perdus.</label>
          <button class="btn pri wide" id="vlt-create">CRÉER LE COFFRE</button><p class="err" id="vlt-err" hidden role="alert"></p>`;
        $("#vlt-create").onclick = async () => {
          setErr("");
          const p = $("#vlt-phrase").value;
          if (p.length < MIN_PHRASE) return setErr("La phrase doit contenir au moins " + MIN_PHRASE + " caractères.");
          if (p !== $("#vlt-phrase2").value) return setErr("Les deux phrases ne sont pas identiques.");
          if (!$("#vlt-ack").checked) return setErr("Coche la case pour confirmer que tu as compris.");
          $("#vlt-create").disabled = true;
          try { await V.create(p); } catch (e) { $("#vlt-create").disabled = false; return setErr(e.message); }
          A.toast("Coffre créé.", "ok"); touch(); show();
        };
      }
      function showLocked() {
        root.innerHTML = `<h3>Coffre-fort <span class="vlt-state">🔒 verrouillé</span></h3>
          <input type="password" id="vlt-phrase" autocomplete="current-password" placeholder="Phrase secrète" aria-label="Phrase secrète">
          <button class="btn pri wide" id="vlt-unlock" style="margin-top:8px">DÉVERROUILLER</button><p class="err" id="vlt-err" hidden role="alert"></p>
          <div class="vlt-danger"><button class="btn wide" id="vlt-panic0">EFFACEMENT TOTAL (appui long)</button><div id="vlt-panicbox"></div></div>`;
        const tryUnlock = async () => {
          setErr(""); const p = $("#vlt-phrase").value; if (!p) return setErr("Saisis ta phrase secrète.");
          $("#vlt-unlock").disabled = true;
          const r = await V.unlock(p);
          if ($("#vlt-unlock")) $("#vlt-unlock").disabled = false;
          if (r.ok) { $("#vlt-phrase").value = ""; touch(); return show(); }
          $("#vlt-phrase").value = "";
          if (r.wait) return countdown(r.wait, r.fails);
          setErr("Phrase incorrecte." + (r.fails >= 2 ? " Encore une erreur et un délai d'attente s'applique." : ""));
        };
        const countdown = (ms, fails) => {
          const end = Date.now() + ms, tick = () => {
            const s = Math.ceil((end - Date.now()) / 1000);
            if (s <= 0) { clearInterval(waitTimer); setErr(""); return; }
            setErr("Trop d'essais (" + fails + "). Réessaie dans " + (s >= 60 ? Math.ceil(s / 60) + " min" : s + " s") + ".");
          };
          clearInterval(waitTimer); tick(); waitTimer = setInterval(tick, 1000);
        };
        $("#vlt-unlock").onclick = tryUnlock; $("#vlt-phrase").onkeydown = (e) => { if (e.key === "Enter") tryUnlock(); };
        V.config().then((c) => { if (c && c.lockUntil > Date.now()) countdown(c.lockUntil - Date.now(), c.fails); });
        panicButton($("#vlt-panic0"), $("#vlt-panicbox"));
      }
      // appui long (0,8 s) -> demande de confirmation explicite
      function panicButton(btn, box) {
        let t = 0, fired = false;
        const start = (e) => { clearTimeout(t); fired = false; t = setTimeout(() => { t = 0; fired = true; confirmPanic(box); }, 800); };
        const stop = () => { clearTimeout(t); t = 0; };
        btn.addEventListener("pointerdown", start); ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, stop));
        btn.addEventListener("click", () => { if (fired) { fired = false; return; } box.innerHTML = '<p class="muted">Maintiens le bouton enfoncé pour effacer le coffre.</p>'; });
        btn.addEventListener("contextmenu", (e) => e.preventDefault());
      }
      function confirmPanic(box) {
        box.innerHTML = `<div class="vlt-warn" role="alertdialog"><b>Tout effacer définitivement ?</b> Tous les fichiers du coffre et la phrase seront détruits. Aucun retour possible.
          <div class="row" style="margin-top:8px"><button class="btn" id="vlt-pno">ANNULER</button><button class="btn pri" id="vlt-pyes">OUI, TOUT EFFACER</button></div></div>`;
        box.querySelector("#vlt-pno").onclick = () => { box.innerHTML = ""; };
        box.querySelector("#vlt-pyes").onclick = async () => {
          clearTimeout(timer); closeView(); revokeAll(); await V.wipe(); A.toast("Coffre effacé.", "ok"); show();
        };
      }

      async function showOpen() {
        root.innerHTML = `<h3>Coffre-fort <span class="vlt-state ok">🔓 ouvert</span></h3>
          <div class="row"><button class="btn pri" id="vlt-add">＋ AJOUTER</button><button class="btn" id="vlt-lock">VERROUILLER</button></div>
          <p class="muted" id="vlt-status" role="status"></p><p class="err" id="vlt-err" hidden role="alert"></p>
          <div class="vlt-grid" id="vlt-list"></div>
          <details class="vlt-set"><summary>Réglages et sécurité</summary>
            <label class="muted" for="vlt-auto">Verrouillage automatique après inactivité</label>
            <select id="vlt-auto"><option value="30">30 secondes</option><option value="60">1 minute</option><option value="120">2 minutes</option><option value="300">5 minutes</option><option value="900">15 minutes</option></select>
            <h4>Changer la phrase</h4>
            <input type="password" id="vlt-old" autocomplete="current-password" placeholder="Phrase actuelle" aria-label="Phrase actuelle">
            <input type="password" id="vlt-new" autocomplete="new-password" placeholder="Nouvelle phrase (10 caractères minimum)" aria-label="Nouvelle phrase" style="margin-top:8px">
            <input type="password" id="vlt-new2" autocomplete="new-password" placeholder="Confirme la nouvelle phrase" aria-label="Confirmation" style="margin-top:8px">
            <button class="btn wide" id="vlt-chg" style="margin-top:8px">CHANGER LA PHRASE</button>
            <div class="vlt-danger"><button class="btn wide" id="vlt-panic0">EFFACEMENT TOTAL (appui long)</button><div id="vlt-panicbox"></div></div>
          </details>`;
        const c = await V.config(); if (c) $("#vlt-auto").value = String(c.autolock);
        $("#vlt-auto").onchange = async (e) => { await V.setAutolock(+e.target.value); touch(); A.toast("Verrouillage automatique réglé.", "ok"); };
        $("#vlt-lock").onclick = () => lock("Coffre verrouillé.");
        $("#vlt-add").onclick = addFiles;
        $("#vlt-chg").onclick = changePhrase;
        panicButton($("#vlt-panic0"), $("#vlt-panicbox"));
        await renderList();
      }
      async function renderList() {
        if (!V.unlocked) return;
        let items = [];
        try { items = await V.list(); } catch (e) { return setErr("Lecture impossible : " + e.message); }
        const L = $("#vlt-list"); if (!L) return;
        L.innerHTML = items.length ? items.map((f) => `<button class="vlt-item" data-id="${esc(f.id)}" aria-label="Ouvrir ${esc(f.name)}"><span class="vlt-th" data-th="${esc(f.id)}">${GLYPH[kindOf(f.type, f.name)]}</span><b>${esc(f.name)}</b><small>${fmt(f.size)}</small></button>`).join("") : '<p class="muted">Le coffre est vide. Ajoute des fichiers : ils seront chiffrés immédiatement.</p>';
        L._items = items;
        items.filter((f) => f.hasThumb).forEach(async (f) => {
          try { const t = await V.thumb(f.id); if (!t || !V.unlocked) return; const sp = L.querySelector(`[data-th="${f.id}"]`); if (sp) sp.innerHTML = `<img alt="" src="${mkUrl(t, "image/jpeg")}">`; } catch (e) { /* vignette illisible */ }
        });
        L.onclick = (e) => { const b = e.target.closest("[data-id]"); if (b) openItem(items.find((x) => x.id === b.dataset.id)); };
      }

      async function thumbOf(bytes, type) {
        try {
          if (!/^image\/(png|jpe?g|webp|gif|bmp)/.test(type)) return null;
          const bmp = await createImageBitmap(new Blob([bytes], { type })), s = Math.min(1, 160 / Math.max(bmp.width, bmp.height));
          const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
          c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
          const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.7));
          return b ? new Uint8Array(await b.arrayBuffer()) : null;
        } catch (e) { return null; }
      }
      async function addFiles() {
        if (busy) return;
        const files = await A.pick({ accept: "*/*", multiple: true });
        if (!files.length || !V.unlocked) return;
        busy = true; setErr(""); let ok = 0;
        try {
          for (let i = 0; i < files.length; i++) {
            const f = files[i], st = $("#vlt-status"); touch();
            if (st) st.textContent = "Chiffrement " + (i + 1) + "/" + files.length + " · " + f.name + "…";
            try {
              const bytes = await A.read(f), type = f.type || "application/octet-stream";
              await V.add(f.name, type, bytes, await thumbOf(bytes, type), (p) => { if (st && files.length === 1) st.textContent = "Chiffrement · " + f.name + " " + Math.round(p * 100) + " %"; });
              ok++;
            } catch (e) { setErr("« " + f.name + " » : " + e.message); }
          }
        } finally { busy = false; }
        const st = $("#vlt-status"); if (st) st.textContent = ok ? ok + " fichier(s) chiffré(s) et rangé(s) dans le coffre." : "";
        touch(); renderList();
      }
      async function changePhrase() {
        setErr(""); const o = $("#vlt-old").value, n = $("#vlt-new").value;
        if (n.length < MIN_PHRASE) return setErr("La nouvelle phrase doit contenir au moins " + MIN_PHRASE + " caractères.");
        if (n !== $("#vlt-new2").value) return setErr("Les deux nouvelles phrases ne sont pas identiques.");
        busy = true; $("#vlt-chg").disabled = true;
        try {
          const r = await V.changePhrase(o, n, (p) => { const st = $("#vlt-status"); if (st) st.textContent = "Rechiffrement… " + Math.round(p * 100) + " %"; });
          if (!r.ok) setErr(r.error); else { A.toast("Phrase changée, fichiers rechiffrés.", "ok"); ["#vlt-old", "#vlt-new", "#vlt-new2"].forEach((s) => { $(s).value = ""; }); const st = $("#vlt-status"); if (st) st.textContent = "Phrase changée."; renderList(); }
        } catch (e) { setErr("Échec : " + e.message); } finally { busy = false; const b = $("#vlt-chg"); if (b) b.disabled = false; touch(); }
      }

      // ---- visionneuse
      function closeView() { if (view) { view.remove(); view = null; } revokeAll(); }
      async function openItem(f) {
        if (!f || !V.unlocked) return;
        closeView();
        view = A.h(`<div class="vlt-view" role="dialog" aria-modal="true" aria-label="Aperçu"><div class="vlt-vh"><b>${esc(f.name)}</b><small>${fmt(f.size)} · ${esc(f.type || "?")}</small></div><div class="vlt-vb" id="vlt-vb"><p class="muted">Déchiffrement…</p></div>
          <div class="vlt-ren" hidden><input type="text" id="vlt-rn" maxlength="120" aria-label="Nouveau nom"><button class="btn pri" id="vlt-rnok">OK</button></div>
          <div class="row vlt-va"><button class="btn" id="vlt-exp">EXPORTER</button><button class="btn" id="vlt-rnb">RENOMMER</button><button class="btn" id="vlt-del">SUPPRIMER</button><button class="btn pri" id="vlt-close">FERMER</button></div></div>`);
        document.body.appendChild(view);
        const v = view, q = (s) => v.querySelector(s);
        q("#vlt-close").onclick = closeView;
        let bytes = null, delArm = 0;
        q("#vlt-exp").onclick = async () => { if (bytes) await A.save(f.name, f.type || "application/octet-stream", bytes); };
        q("#vlt-rnb").onclick = () => { q(".vlt-ren").hidden = false; q("#vlt-rn").value = f.name; q("#vlt-rn").focus(); };
        q("#vlt-rnok").onclick = async () => {
          const nn = q("#vlt-rn").value.trim().replace(/[\\/\u0000-\u001f]/g, "_");
          if (!nn) return;
          try { await V.rename(f.id, nn); closeView(); renderList(); A.toast("Renommé.", "ok"); } catch (e) { A.toast(e.message, "err"); }
        };
        q("#vlt-del").onclick = async () => {
          if (!delArm) { q("#vlt-del").textContent = "CONFIRMER ?"; delArm = setTimeout(() => { delArm = 0; const b = v.querySelector("#vlt-del"); if (b) b.textContent = "SUPPRIMER"; }, 3500); return; }
          clearTimeout(delArm); await V.remove(f.id); closeView(); renderList(); A.toast("Fichier supprimé du coffre.", "ok");
        };
        try {
          bytes = await V.read(f.id); if (view !== v) return;
          const body = q("#vlt-vb"), k = kindOf(f.type, f.name);
          if (k === "img") body.innerHTML = `<img alt="${esc(f.name)}" src="${mkUrl(bytes, f.type)}">`;
          else if (k === "vid") body.innerHTML = `<video controls playsinline src="${mkUrl(bytes, f.type)}"></video>`;
          else if (k === "aud") body.innerHTML = `<audio controls src="${mkUrl(bytes, f.type)}"></audio>`;
          else if (k === "txt") { const pre = document.createElement("pre"); pre.className = "out"; pre.textContent = dec.decode(bytes.subarray(0, 200000)); body.innerHTML = ""; body.appendChild(pre); }
          else if (k === "pdf") {
            body.innerHTML = "";
            try { const doc = await A.pdfOpen(bytes); for (let p = 1; p <= Math.min(doc.numPages, 8); p++) { const cv = await A.pdfRender(doc, p, 1.2); if (view !== v) return; cv.className = "vlt-page"; body.appendChild(cv); } }
            catch (e) { body.innerHTML = '<p class="muted">Aperçu PDF indisponible : exporte le fichier pour le lire.</p>'; }
          } else body.innerHTML = '<p class="muted">Pas d\'aperçu pour ce type : utilise EXPORTER.</p>';
        } catch (e) { const b = q("#vlt-vb"); if (b) b.innerHTML = '<p class="err">Déchiffrement impossible : ' + esc(e.message) + "</p>"; }
      }

      show();
    },
    onShow() { /* l'état (verrouillé / ouvert) est conservé tant que l'app reste au premier plan */ },
  });
})();
