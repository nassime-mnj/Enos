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

  function ask(blob) {
    const s = U.sheet({ title: "Importer depuis le PC", html: `
      <p class="muted" style="margin-bottom:12px">Tes clés, liens et le jumelage du PC sont prêts. Saisis le <b>code à 10 caractères affiché sur l'écran du PC</b> pour les déchiffrer.</p>
      <div class="f"><label for="imp-code">Code du PC</label><div class="r"><input id="imp-code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX" maxlength="14" style="letter-spacing:3px;text-transform:uppercase"></div></div>
      <div id="imp-msg" class="muted" style="min-height:22px;margin-bottom:10px"></div>
      <div class="row"><button class="btn pri" id="imp-go">IMPORTER</button></div>` });
    const inp = s.querySelector("#imp-code"), msg = s.querySelector("#imp-msg"), go = s.querySelector("#imp-go");
    setTimeout(() => inp.focus(), 280);
    const run = async () => {
      if (inp.value.replace(/[^A-Za-z0-9]/g, "").length < 10) { msg.textContent = "Le code fait 10 caractères."; return; }
      go.disabled = true; msg.textContent = "Déchiffrement…";
      const r = await apply(blob, inp.value);
      if (!r.ok) { msg.textContent = r.error || "Échec."; go.disabled = false; return; }
      Object.entries(r.settings || {}).forEach(([k, v]) => E.settings.set(k, v));
      U.closeSheet();
      U.toast("Importé : " + (r.imported || []).map((n) => NAMES[n] || n).join(", "), "ok", 7000);
      E.emit("settings", "pcAddrs"); E.emit("settings", "pcPaired"); E.emit("settings", "name");
      E.agenda.refresh(true); E.views.renderDay();
      E.link.probeNow();
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

  // Secours : coller le fichier (page du PC › « Copier le fichier »)
  I.paste = async () => {
    const s = U.sheet({ title: "Coller le fichier d'import", html: `<div class="f"><label for="imp-blob">Fichier copié depuis la page du PC</label><div class="r"><input id="imp-blob" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="Colle ici"></div></div><div class="row"><button class="btn pri" id="imp-next">SUIVANT</button></div>` });
    s.querySelector("#imp-next").onclick = () => { const b = s.querySelector("#imp-blob").value.trim(); if (b.length < 50) return U.toast("Fichier trop court.", "warn"); U.closeSheet(true); ask(b); };
  };
})();
