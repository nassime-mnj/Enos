"use strict";
// IMPORT DE LA CONFIGURATION DU PC : le script envoyer_cles.py (PC) fabrique un fichier CHIFFRÉ ; le téléphone le reçoit par le lien enos://import
// (bouton de la page ouverte via le QR code) ou par copier-coller, puis demande le code affiché sur l'écran du PC. Le déchiffrement se fait en Java.
(() => {
  const E = window.ENOS, N = E.native, U = E.ui, $ = E.$;
  const I = (E.importer = {});
  const NAMES = { groq: "Clé Groq", eleven_enos: "Clé ElevenLabs E.N.O.S.", eleven_eto: "Clé ElevenLabs ETO", ics_zeus: "Lien Zeus", ics_moodle: "Lien Moodle", pc_token: "Jeton du PC", pc_addrs: "Adresses du PC", pc_cert: "Certificat du PC (empreinte)", pc_device: "Approbation de l'appareil" };

  const apply = (blob, code) => new Promise((res) => {
    if (!N.available) return res({ ok: false, error: "Disponible dans l'application Android." });
    N.importApply(blob, code).then(res);
  });

  // Préférences connues du téléphone (liste blanche, valeurs validées) ; le reste du paquet est ignoré.
  const PREFS = { persona: (v) => (v === "enos" || v === "eto" ? v : undefined), hue: (v) => (Number.isFinite(+v) ? Math.max(0, Math.min(360, Math.round(+v))) : undefined),
    "chess.power": (v) => (Number.isFinite(+v) ? Math.max(1, Math.min(100, Math.round(+v))) : undefined), "chess.comment": (v) => (typeof v === "boolean" ? v : undefined) };
  function applyExtras(r) {
    Object.entries(r.prefs || {}).forEach(([k, v]) => { const ok = PREFS[k] && PREFS[k](v); if (ok !== undefined) E.settings.set(k, ok); });
    if (E.theme && r.prefs && PREFS.hue(r.prefs.hue) !== undefined) E.theme.apply(PREFS.hue(r.prefs.hue));
    const have = new Set(E.agenda.tasks.map((t) => t.id));
    const fresh = (r.tasks || []).filter((t) => !have.has(t.id)).map((t) => ({ ...t, updated: Date.now() / 1000 }));
    if (fresh.length) { E.agenda.tasks.push(...fresh); E.store.set("tasks", E.agenda.tasks); E.emit("agenda", {}); }
    return fresh.length;
  }

  // Après un import réussi : préférences, tâches, message, relance de la recherche du PC
  function finish(r, blob, ceo) {
    Object.entries(r.settings || {}).forEach(([k, v]) => E.settings.set(k, v));
    const nt = applyExtras(r);
    if (ceo) E.store.set("ceo.done", blob.slice(0, 40));                           // ne redemande plus pour CE paquet (le sel est unique)
    U.closeSheet();
    U.toast("Importé : " + (r.imported || []).map((n) => NAMES[n] || n).join(", ") + (nt ? ` · ${nt} tâche(s)` : ""), "ok", 7000);
    E.emit("settings", "pcAddrs"); E.emit("settings", "pcPaired"); E.emit("settings", "name");
    E.agenda.refresh(true); E.views.renderDay();
    E.link.probeNow();
  }

  // Lien d'appairage du QR du PC (enos://pair?d=PAQUET&c=CODE) : le code est dans le lien, donc rien à saisir
  I.applyLink = async (text) => {
    const m = /^enos:\/\/pair\?(.+)$/.exec(String(text || "").trim());
    if (!m) return { ok: false, error: "Ce QR code n'est pas un appairage E.N.O.S." };
    const q = new URLSearchParams(m[1]);
    const blob = q.get("d") || "", code = q.get("c") || "";
    if (blob.length < 50 || code.length < 10) return { ok: false, error: "QR incomplet." };
    const r = await apply(blob, code);
    if (r.ok) finish(r, blob, false);
    return r;
  };

  // ceo=true : paquet intégré à l'application (exporter_donnees_ceo.py) -> phrase secrète libre au lieu du code à 10 caractères
  function ask(blob, ceo) {
    const s = U.sheet({ title: ceo ? "Données CEO" : "Importer depuis le PC", html: `
      <p class="muted" style="margin-bottom:12px">${ceo ? "Cette application contient tes clés, ton emploi du temps et tes préférences, <b>chiffrés</b>. Saisis ta <b>phrase secrète</b> (choisie sur le PC à l'export) pour les ranger dans le coffre du téléphone." : "Tes clés, liens et le jumelage du PC sont prêts. Saisis le <b>code à 10 caractères affiché sur l'écran du PC</b> pour les déchiffrer."}</p>
      <div class="f"><label for="imp-code">${ceo ? "Phrase secrète" : "Code du PC"}</label><div class="r"><input id="imp-code" type="${ceo ? "password" : "text"}" autocomplete="off" autocapitalize="${ceo ? "none" : "characters"}" spellcheck="false" placeholder="${ceo ? "••••••••••••" : "XXXXX-XXXXX"}" maxlength="${ceo ? 120 : 14}" style="${ceo ? "" : "letter-spacing:3px;text-transform:uppercase"}"></div></div>
      <div id="imp-msg" class="muted" style="min-height:22px;margin-bottom:10px"></div>
      <div class="row"><button class="btn pri" id="imp-go">IMPORTER</button></div>` });
    const inp = s.querySelector("#imp-code"), msg = s.querySelector("#imp-msg"), go = s.querySelector("#imp-go");
    setTimeout(() => inp.focus(), 280);
    const run = async () => {
      if (inp.value.replace(/[^A-Za-z0-9]/g, "").length < (ceo ? 12 : 10)) { msg.textContent = ceo ? "Phrase trop courte (12 lettres ou chiffres minimum)." : "Le code fait 10 caractères."; return; }
      go.disabled = true; msg.textContent = "Déchiffrement…";
      const r = await apply(blob, inp.value);
      if (!r.ok) { msg.textContent = r.error || "Échec."; go.disabled = false; return; }
      finish(r, blob, ceo);
    };
    go.onclick = run;
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } };
  }

  // Appelé au démarrage et par Java (nouvelle intention enos://import) : propose l'import si un fichier est en attente
  I.check = () => {
    if (!N.available) return;
    const blob = N.pendingImport();
    if (blob) ask("");                                   // « » = le fichier gardé en mémoire par Java
  };

  // Paquet CEO embarqué dans l'APK (js/ceo_bundle.js, généré juste avant la compilation) : proposé une seule fois par paquet
  I.checkBundled = () => {
    const b = window.ENOS_CEO;
    if (!N.available || !b || E.store.get("ceo.done", "") === b.slice(0, 40)) return;
    ask(b, true);
  };

  // Secours : coller le fichier (page du PC › « Copier le fichier »)
  I.paste = async () => {
    const s = U.sheet({ title: "Coller le fichier d'import", html: `<div class="f"><label for="imp-blob">Fichier copié depuis la page du PC</label><div class="r"><input id="imp-blob" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="Colle ici"></div></div><div class="row"><button class="btn pri" id="imp-next">SUIVANT</button></div>` });
    s.querySelector("#imp-next").onclick = async () => { const b = s.querySelector("#imp-blob").value.trim(); if (/^enos:\/\/pair\?/.test(b)) { const r = await I.applyLink(b); if (!r.ok) U.toast(r.error || "Échec.", "warn"); return; } if (b.length < 50) return U.toast("Fichier trop court.", "warn"); U.closeSheet(true); ask(b); };
  };
})();
