"use strict";
// CLOUD Dual Pulse (serveur Render + Supabase + R2) : compte, session, presse-papiers, appareils, mises à jour. Tout passe par le pont natif :
//   provider "cloud"         -> https://<serveur>/launcher/v1/… avec le jeton d'accès du COFFRE-FORT (jamais lu par le JS)
//   provider "cloud_refresh" -> renouvelle la session côté Java ; le JS ne voit jamais les nouveaux jetons
// Seuls l'adresse du serveur et le profil (e-mail, rôle) sont gardés hors du coffre. Au login, les jetons transitent un instant par le JS avant d'être mis dans le coffre.
(() => {
  const E = window.ENOS, N = E.native;
  const C = (E.cloud = {});
  const V1 = "/launcher/v1";

  C.url = () => E.settings.get("cloudUrl", "");
  C.setUrl = (u) => {
    u = String(u || "").trim().replace(/\/+$/, "");
    if (!/^https:\/\/[^\s/]+$/i.test(u) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(u)) throw new Error("Adresse invalide : https:// obligatoire.");
    E.settings.set("cloudUrl", u); N.vault.set("cloud_url", u);
  };
  C.user = () => E.store.get("cloud.user", null);
  C.loggedIn = () => !!C.user() && N.vault.has("cloud_refresh");
  const setUser = (u) => { E.store.set("cloud.user", u); E.emit("cloud", u); };

  const call = (opts) => N.fetch({ provider: "cloud", method: "GET", headers: { "Content-Type": "application/json" }, ...opts });
  let refreshing = null;
  const refresh = () => refreshing || (refreshing = N.fetch({ provider: "cloud_refresh", path: "/", method: "POST" }).then((r) => { if (r.status !== 200) throw new Error("session refusée"); const j = r.json(); if (j && j.user) setUser(j.user); return true; }).finally(() => { refreshing = null; }));

  // C.req(chemin, {method, body, auth}) -> {status, json}  (renouvelle la session une fois si le jeton est expiré)
  C.req = async (path, o) => {
    o = o || {};
    const opts = { path: V1 + path, method: o.method || "GET", body: o.body === undefined ? "" : JSON.stringify(o.body) };
    let r = await call(opts);
    if (r.status === 401 && o.auth !== false && N.vault.has("cloud_refresh")) {
      try { await refresh(); r = await call(opts); } catch (e) { await C.logout(true); throw new Error("Session expirée : reconnecte-toi."); }
    }
    return { status: r.status, json: r.json() || {} };
  };
  const must = (r, fallback) => { if (r.status >= 400) throw Object.assign(new Error((r.json && r.json.detail) || fallback || "Erreur " + r.status), { status: r.status, extra: r.json }); return r.json; };

  // l'hébergeur gratuit s'endort : un 1er appel peut prendre ~1 minute. wake() est silencieux et tolérant.
  C.wake = async () => { try { await call({ path: V1 + "/keys" }); return true; } catch (e) { return false; } };

  const post = async (path, body) => { const r = await call({ path: V1 + path, method: "POST", body: JSON.stringify(body) }); return { status: r.status, json: r.json() || {} }; };
  const adopt = async (j) => { N.vault.set("cloud_access", j.access_token); N.vault.set("cloud_refresh", j.refresh_token); setUser(j.user); return j.user; };
  C.login = async (email, password, totp) => adopt(must(await post("/auth/login", { email, password, totp: totp || "", device: "Téléphone" }), "Connexion refusée"));
  C.register = async (invite, email, password, name) => adopt(must(await post("/auth/register", { invite, email, password, name: name || "" }), "Inscription refusée"));
  C.logout = async (silent) => { try { await N.fetch({ provider: "cloud_logout", path: "/", method: "POST" }); } catch (e) { /* hors ligne */ } E.store.del("cloud.user"); E.emit("cloud", null); if (!silent && E.ui) E.ui.toast("Déconnecté du cloud.", "ok"); };

  // ------------------------------------------------------------------ presse-papiers universel
  C.clip = {
    send: async (kind, content, mime) => must(await C.req("/clipboard", { method: "POST", body: { kind, content, mime: mime || "", device: "phone" } }), "Envoi impossible"),
    list: async (sinceId) => must(await C.req("/clipboard?limit=30&since_id=" + (sinceId || 0)), "Lecture impossible").items || [],
    remove: async (id) => must(await C.req("/clipboard/" + id, { method: "DELETE" }), "Suppression impossible"),
  };

  // ------------------------------------------------------------------ appareil visible du PC (ADB sans fil / scrcpy) : le téléphone annonce son nom, ses adresses Wi-Fi et le port ADB
  C.lanIps = () => { try { return JSON.parse(window.Enos && window.Enos.lanIps ? window.Enos.lanIps() : "[]"); } catch (e) { return []; } };
  C.beat = async () => {
    if (!C.loggedIn()) return false;
    const r = await C.req("/devices/beat", { method: "POST", body: { device_id: N.deviceId(), name: E.settings.get("deviceName", "Téléphone"), platform: "android", lan_ips: C.lanIps(), adb_port: +E.settings.get("adbPort", 5555) || 0, app_version: N.version() } });
    return r.status === 200;
  };

  // ------------------------------------------------------------------ mises à jour de l'application (OTA)
  C.updateSetup = async () => {
    const j = must(await C.req("/mobile/update-token", { method: "POST", body: { device_id: N.deviceId() } }), "Jeton de mise à jour refusé");
    N.vault.set("cloud_update_base", C.url() + "/m/" + j.token + "/");
    return true;
  };
  C.checkUpdate = async (manual) => {
    if (!C.loggedIn()) { if (manual) E.ui.toast("Connecte-toi au cloud pour recevoir les mises à jour.", "warn"); return false; }
    if (manual) E.ui.toast("Réveil du serveur cloud (jusqu'à 1 minute au premier appel)…");
    await C.wake();
    if (!N.vault.has("cloud_update_base")) await C.updateSetup();
    if (window.Enos && window.Enos.checkCloudUpdate) { window.Enos.checkCloudUpdate(!!manual); return true; }
    if (manual) E.ui.toast("Mise à jour disponible uniquement dans l'application Android.", "warn");
    return false;
  };
  const AUTO = 6 * 3600 * 1000;
  C.autoUpdate = async () => {
    if (!C.loggedIn() || !E.settings.get("autoUpdate", true)) return;
    if (Date.now() - E.store.get("cloud.lastCheck", 0) < AUTO) return;
    E.store.set("cloud.lastCheck", Date.now());
    try { await C.checkUpdate(false); } catch (e) { /* silencieux : réessai au prochain démarrage */ }
  };

  // ------------------------------------------------------------------ agenda (tâches) via le cloud : « la dernière modification gagne », option explicite
  C.syncAgenda = async () => {
    if (!C.loggedIn() || !E.settings.get("cloudAgenda", false)) return false;
    const since = E.store.get("cloud.agSince", 0), G = E.agenda;
    const mine = G.tasks.filter((t) => (t.updated || 0) > since).slice(0, 500).map((t) => ({ id: t.id, title: t.title || "", due: t.due || "", notes: t.notes || "", done: !!t.done, created: t.created || "", updated: t.updated || 0, deleted: !!t.deleted, duration_min: t.duration_min || 0 }));
    const r = await C.req("/agenda/sync", { method: "POST", body: { since, tasks: mine } });
    must(r, "Synchronisation de l'agenda refusée");
    let changed = false;
    (r.json.tasks || []).forEach((t) => {
      const cur = G.tasks.find((x) => x.id === t.id);
      if (!cur) { G.tasks.push({ ...t, dirty: false }); changed = true; }
      else if ((t.updated || 0) > (cur.updated || 0)) { Object.assign(cur, t, { dirty: false }); changed = true; }
    });
    E.store.set("cloud.agSince", r.json.now || Date.now() / 1000);
    if (changed) { E.store.set("tasks", G.tasks); E.emit("agenda", {}); }
    return true;
  };

  C.start = () => {
    setTimeout(() => { C.autoUpdate(); C.beat().catch(() => {}); }, 4000);
    setInterval(() => { if (!document.hidden) { C.beat().catch(() => {}); C.syncAgenda().catch(() => {}); } }, 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { C.autoUpdate(); C.beat().catch(() => {}); } });
  };
})();
