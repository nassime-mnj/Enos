"use strict";
// STATISTIQUES ANONYMES (désactivées par défaut) : nombre d'ouvertures par module, envoyé au plus une fois par jour avec un identifiant
// d'installation aléatoire, jamais lié au compte. Réglage : Modules › Paramètres › Informations légales › Confidentialité.
(() => {
  const E = window.ENOS;
  const M = (E.metrics = {});
  const today = () => new Date().toISOString().slice(0, 10);
  M.enabled = () => !!E.settings.get("metrics.on", false);
  M.set = (on) => { E.settings.set("metrics.on", !!on); if (!on) E.store.del("metrics.buf"); };
  const install = () => { let id = E.store.get("metrics.install", ""); if (!/^[0-9a-f]{32}$/.test(id)) { const a = new Uint8Array(16); crypto.getRandomValues(a); id = [...a].map((b) => b.toString(16).padStart(2, "0")).join(""); E.store.set("metrics.install", id); } return id; };
  M.count = (id) => {
    if (!M.enabled() || !id) return;
    const b = E.store.get("metrics.buf", null) || { day: today(), mods: {} };
    b.mods[id] = (b.mods[id] || 0) + 1; E.store.set("metrics.buf", b);
  };
  M.flush = async (force) => {
    if (!M.enabled() || !E.cloud || !E.cloud.url()) return false;
    const b = E.store.get("metrics.buf", null), sent = E.store.get("metrics.sent", "");
    if (!b || (!force && sent === today())) return false;
    try {
      const r = await E.cloud.req("/eto/metrics", { method: "POST", auth: false, body: { install: install(), version: String(E.native.version()), plan: E.plans ? E.plans.current() : "", modules: b.mods } });
      if (r.status !== 200) return false;
      E.store.set("metrics.sent", today()); if (b.day !== today()) E.store.del("metrics.buf");
      return true;
    } catch (e) { return false; }
  };
  setTimeout(() => M.flush(false), 15000);
})();
