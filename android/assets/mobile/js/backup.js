"use strict";
// SAUVEGARDE de l'application (parties, entraînements, préférences, statistiques…) qui SURVIT aux réinstallations.
//   · Tout l'état est dans le localStorage (clés « enos.* ») : un instantané JSON en est fait automatiquement (si quelque chose a changé : toutes les 2 min et quand l'appli passe en arrière-plan).
//   · Copie LOCALE : Téléchargements/ENOS/enos-sauvegarde-<jour>.json (MediaStore, les 6 plus récentes gardées) — reste sur le téléphone après la désinstallation.
//   · Copie CLOUD : compte Dual Pulse (POST /launcher/v1/backup, gzip + base64) — repêchée sur n'importe quel téléphone connecté au compte.
//   · Restauration : FUSION (rien n'est perdu : union des parties, plus grands compteurs…) ou REMPLACEMENT ; depuis un fichier, la liste du téléphone ou le cloud.
// Jamais sauvegardés : clés d'API, jetons, coffre-fort (mots de passe) — ils restent dans le coffre Android.
(() => {
  const E = window.ENOS, N = E.native;
  const BK = (E.backup = {});
  const P = "enos.";
  const SKIP = /token|secret|passw|vault|apikey|api_key|(^|[.])keys?($|[.])|cloud[.]user|^enos[.]backup[.]|[.]cache($|[.])/i;
  const CAP = 300;                                                                         // parties conservées au maximum après fusion
  const ls = (f) => { try { return f(localStorage); } catch (e) { return null; } };

  BK.keys = () => { const out = []; ls((s) => { for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(P) && !SKIP.test(k)) out.push(k); } }); return out; };
  BK.snapshot = () => {
    const keys = {}; BK.keys().forEach((k) => { const v = ls((s) => s.getItem(k)); if (v != null) keys[k] = v; });
    return { app: "ENOS", v: 1, t: Date.now(), device: N.deviceId(), ver: N.version(), keys };
  };
  BK.valid = (s) => !!(s && s.app === "ENOS" && s.keys && typeof s.keys === "object");
  const arr = (snap, k) => { try { const a = JSON.parse(snap.keys[k] || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  /** résumé lisible d'un instantané */
  BK.summary = (snap) => {
    const ks = Object.keys(snap.keys), bytes = ks.reduce((a, k) => a + snap.keys[k].length, 0);
    return { t: snap.t, keys: ks.length, bytes, games: arr(snap, "enos.defi.hist").length, prefs: ks.filter((k) => k.startsWith("enos.s.")).length, training: ks.filter((k) => /train|learn|brain|royale|variants/i.test(k)).length, device: snap.device || "" };
  };

  // ---- fusion : monotone (rien ne se perd) — nombres : le plus grand ; tableaux : union (par date `t` pour les objets) ; objets : récursif ; le reste : la valeur locale
  function merge(a, b) {
    if (a === undefined) return b;
    if (b === undefined || b === null) return a;
    if (typeof a === "number" && typeof b === "number") return Math.max(a, b);
    if (Array.isArray(a) && Array.isArray(b)) {
      const seen = new Set(), out = [];
      const id = (x) => (x && typeof x === "object" && x.t != null ? "t" + x.t : JSON.stringify(x));
      [...b, ...a].forEach((x) => { const k = id(x); if (!seen.has(k)) { seen.add(k); out.push(x); } });
      if (out.length && out.every((x) => x && typeof x === "object" && typeof x.t === "number")) out.sort((x, y) => x.t - y.t);
      return out.length > CAP ? out.slice(-CAP) : out;
    }
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const o = { ...a }; Object.keys(b).forEach((k) => { o[k] = merge(a[k], b[k]); }); return o;
    }
    return a;
  }
  BK.merge = merge;
  /** applique un instantané. mode : "merge" (défaut) | "replace". Retourne {added, merged, same, skipped}. */
  BK.restore = (snap, mode) => {
    if (!BK.valid(snap)) throw new Error("Fichier de sauvegarde invalide.");
    const r = { added: 0, merged: 0, same: 0, skipped: 0 };
    Object.keys(snap.keys).forEach((k) => {
      if (!k.startsWith(P) || SKIP.test(k) || typeof snap.keys[k] !== "string") { r.skipped++; return; }
      const b = snap.keys[k], l = ls((s) => s.getItem(k));
      if (mode === "replace" || l == null) { ls((s) => s.setItem(k, b)); r.added++; }
      else if (l === b) r.same++;
      else { try { ls((s) => s.setItem(k, JSON.stringify(merge(JSON.parse(l), JSON.parse(b))))); r.merged++; } catch (e) { r.skipped++; } }
    });
    return r;
  };

  // ---- compression pour le cloud (gzip + base64) ; repli sans compression si le navigateur ne sait pas
  const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function pack(text) {
    if (window.CompressionStream) { try { const cs = new CompressionStream("gzip"), w = cs.writable.getWriter(); w.write(new TextEncoder().encode(text)); w.close(); return "g:" + b64(new Uint8Array(await new Response(cs.readable).arrayBuffer())); } catch (e) { /* repli */ } }
    return "p:" + b64(new TextEncoder().encode(text));
  }
  async function unpack(z) {
    const kind = z.startsWith("p:") ? "p" : "g", raw = unb64(z.replace(/^[gp]:/, ""));
    if (kind === "p") return new TextDecoder().decode(raw);
    const ds = new DecompressionStream("gzip"), w = ds.writable.getWriter(); w.write(raw); w.close();
    return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
  }
  BK._pack = pack; BK._unpack = unpack;

  // ---- état et réglages
  const cfg = () => ({ local: E.settings.get("backup.local", true), cloud: E.settings.get("backup.cloud", true) });
  BK.cfg = cfg;
  BK.meta = () => ls((s) => JSON.parse(s.getItem("enos.backup.meta") || "null")) || null;
  const setMeta = (m) => ls((s) => s.setItem("enos.backup.meta", JSON.stringify(m)));
  const dayName = () => "enos-sauvegarde-" + new Date().toISOString().slice(0, 10) + ".json";
  BK.cloudOk = () => !!(E.cloud && E.cloud.loggedIn && E.cloud.loggedIn());

  BK.cloudPut = async (snap) => {
    const z = await pack(JSON.stringify(snap)), s = BK.summary(snap);
    const r = await E.cloud.req("/backup", { method: "POST", body: { device: N.deviceId(), doc: { v: 1, t: snap.t, z, meta: { games: s.games, keys: s.keys, ver: snap.ver } } } });
    if (r.status >= 400) throw Object.assign(new Error((r.json && r.json.detail) || "Erreur " + r.status), { status: r.status });
    return true;
  };
  BK.cloudList = async () => { const r = await E.cloud.req("/backup"); if (r.status >= 400) throw new Error((r.json && r.json.detail) || "Erreur " + r.status); return r.json.items || []; };
  BK.cloudGet = async (device) => {
    const r = await E.cloud.req("/backup/latest" + (device ? "?device=" + encodeURIComponent(device) : ""));
    if (r.status === 404) throw new Error("Aucune sauvegarde dans le cloud.");
    if (r.status >= 400) throw new Error((r.json && r.json.detail) || "Erreur " + r.status);
    return JSON.parse(await unpack(r.json.doc.z));
  };

  let busy = false, dirty = false, lastRun = 0;
  /** sauvegarde maintenant (local + cloud selon les réglages) ; retourne {local, cloud, size, err} */
  BK.save = async (force) => {
    if (busy) return null;
    busy = true;
    const c = cfg(), res = { local: false, cloud: false, err: "" };
    try {
      const snap = BK.snapshot(), text = JSON.stringify(snap);
      res.size = text.length; res.games = BK.summary(snap).games;
      if (c.local && N.backup.can()) res.local = N.backup.write(dayName(), text);
      if (c.cloud && BK.cloudOk()) { try { res.cloud = await BK.cloudPut(snap); } catch (e) { res.err = e.status === 404 || e.status === 405 ? "serveur cloud pas à jour (sauvegarde cloud indisponible)" : e.message; } }
      const old = BK.meta() || {};
      setMeta({ t: Date.now(), local: res.local ? Date.now() : old.local || 0, cloud: res.cloud ? Date.now() : old.cloud || 0, size: res.size, games: res.games, err: res.err });
      if (res.local || res.cloud || force) dirty = false;
      lastRun = Date.now();
    } catch (e) { res.err = e.message; }
    busy = false; E.emit("backup", res);
    return res;
  };

  // ---- sauvegarde automatique : on note ce qui change, puis on sauvegarde au plus toutes les 2 minutes et à la mise en arrière-plan
  const mark = (k) => { if (!SKIP.test(P + String(k))) dirty = true; };
  const set0 = E.store.set, del0 = E.store.del;
  E.store.set = (k, v) => { set0(k, v); mark(k); };
  E.store.del = (k) => { del0(k); mark(k); };
  const tick = () => { if (dirty && Date.now() - lastRun > 120000) BK.save(); };
  BK.dirty = () => dirty;

  // ---- nouvelle installation : propose de retrouver les données
  async function firstRun() {
    if (ls((s) => s.getItem("enos.backup.asked"))) return;
    const have = BK.keys().length, games = (E.store.get("defi.hist", []) || []).length;
    if (games > 0 || have > 12) { ls((s) => s.setItem("enos.backup.asked", "1")); return; }                  // il y a déjà des données : rien à proposer
    ls((s) => s.setItem("enos.backup.asked", "1"));
    const found = N.backup.list();
    if (found.length) {
      const f = found[0], txt = N.backup.read(f.id);
      let sn = null; try { sn = JSON.parse(txt); } catch (e) { /* illisible */ }
      if (BK.valid(sn)) { const s = BK.summary(sn); return E.ui.sheet({ title: "Sauvegarde retrouvée", html: `<p class="muted">Nouvelle installation détectée. Sauvegarde du <b>${new Date(sn.t).toLocaleString("fr-FR")}</b> : ${s.games} partie(s), ${s.prefs} réglage(s), ${s.keys} données au total.</p>`,
        options: [{ label: "RESTAURER", cls: "pri", fn: () => { BK.restore(sn, "merge"); E.ui.toast("Restauré, rechargement…", "ok"); setTimeout(() => location.reload(), 700); } }, { label: "PLUS TARD" }] }); }
    }
    E.ui.toast("Nouvelle installation : retrouve tes parties dans Modules › Sauvegarde (fichier ou cloud).", "ok", 6000);
  }

  BK.firstRun = firstRun;
  BK.start = () => {
    setTimeout(() => { firstRun().catch(() => {}); const m = BK.meta(); if (!m || Date.now() - m.t > 24 * 3600 * 1000) dirty = dirty || BK.keys().length > 0; tick(); }, 6000);
    setInterval(tick, 30000);
    document.addEventListener("visibilitychange", () => { if (document.hidden && dirty) BK.save(); });
    window.addEventListener("pagehide", () => { if (dirty) BK.save(); });
  };
  BK.start();
})();
