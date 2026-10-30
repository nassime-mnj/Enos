"use strict";
// RÉGLAGES (feuille du bas) : profil, clés d'API (coffre Keystore : jamais ré-affichées), liens d'agenda, appairage du PC (adresses + jeton + empreinte du certificat).
(() => {
  const E = window.ENOS, $ = E.$, esc = E.esc, N = E.native, U = E.ui;

  const secretField = (id, label, vaultKey, ph, hint) => `<div class="f" data-vk="${vaultKey}"><label for="${id}">${label}</label>
    ${N.vault.has(vaultKey) ? `<div class="r"><span class="ok" style="flex:1;align-self:center">✓ enregistrée dans le coffre</span><button class="mini" data-replace="${vaultKey}">REMPLACER</button><button class="mini" data-forget="${vaultKey}">EFFACER</button></div>`
      : `<div class="r"><input id="${id}" type="password" placeholder="${ph}" autocomplete="off" spellcheck="false" autocapitalize="off"></div>`}${hint ? `<small>${hint}</small>` : ""}</div>`;

  function open(section) {
    const cfg = N.pc.config(), wu = N.webUpdateInfo();
    const s = U.sheet({ title: "Réglages", html: `
      <div class="sec-t">Appairer avec le PC</div>
      <div class="f"><div class="r"><button class="btn pri" id="st-scan" style="flex:1">SCANNER LE QR DU PC</button></div>
        <small>Sur le PC : bouton « APPAIRER LE TÉLÉPHONE ». Importe d'un coup tes clés, réglages et le PC (adresses Wi-Fi + Tailscale), sans rien taper. Pour joindre le PC en 5G, installe Tailscale sur le PC et le téléphone.</small></div>

      <div class="sec-t">Mise à jour</div>
      <div class="f"><div class="r"><button class="btn pri" id="st-upd" style="flex:1">METTRE À JOUR</button></div>
        <small id="st-upd-msg">Récupère la dernière version depuis GitHub, sans réinstaller l'application${wu.label ? " · actuelle : " + esc(wu.label) : ""}.</small></div>
      <div class="f"><label for="st-upd-auto">Télécharger automatiquement au lancement</label><div class="r"><input id="st-upd-auto" type="checkbox" ${wu.auto ? "checked" : ""}></div></div>
      <div class="f"><label for="st-upd-br">Branche GitHub</label><div class="r"><input id="st-upd-br" type="text" value="${esc(wu.branch || "main")}" spellcheck="false" autocapitalize="off"></div></div>

      <div class="sec-t">Profil</div>
      <div class="f"><label for="st-name">Ton prénom</label><div class="r"><input id="st-name" type="text" value="${esc(E.settings.get("name", "Nassime"))}" maxlength="30"></div></div>

      <div class="f"><label for="st-anim">Animations de transition entre les pages</label><div class="r"><input id="st-anim" type="checkbox" ${E.settings.get("anim", true) ? "checked" : ""}></div></div>

      <div class="sec-t">Clés d'API · mode autonome</div>
      ${secretField("st-groq", "Groq (cerveau)", "groq", "gsk_…", "Les appels partent du téléphone vers Groq, sans passer par le PC.")}
      <div class="f"><label for="st-model">Modèle Groq</label><div class="r"><input id="st-model" type="text" value="${esc(E.settings.get("model", "openai/gpt-oss-120b"))}" spellcheck="false" autocapitalize="off"></div></div>
      ${secretField("st-el1", "ElevenLabs · voix E.N.O.S.", "eleven_enos", "sk_…")}
      <div class="f" id="vc-enos"><label>Voix E.N.O.S.</label><div class="r"><button class="mini" data-voices="eleven_enos" data-p="enos" style="margin:0">${esc(E.settings.get("voice_name_enos", "")) || "CHOISIR LA VOIX"}</button></div></div>
      ${secretField("st-el2", "ElevenLabs · voix ETO", "eleven_eto", "sk_…")}
      <div class="f" id="vc-eto"><label>Voix ETO</label><div class="r"><button class="mini" data-voices="eleven_eto" data-p="eto" style="margin:0">${esc(E.settings.get("voice_name_eto", "")) || "CHOISIR LA VOIX"}</button></div></div>

      <div class="sec-t">Agenda · liens .ics</div>
      ${secretField("st-zeus", "Zeus (emploi du temps)", "ics_zeus", "https://…", "Zeus → Mon planning → Exporter.")}
      ${secretField("st-moodle", "Moodle (calendrier)", "ics_moodle", "https://…", "Moodle → Calendrier → Exporter → copier l'URL.")}

      <div class="sec-t" id="st-pc">PC · mode connecté</div>
      <div class="f"><label for="st-addrs">Adresses du PC (Wi-Fi, Tailscale)</label><div class="r"><input id="st-addrs" type="text" value="${esc(cfg.addrs || "")}" placeholder="192.168.1.28, 100.64.0.5" spellcheck="false" autocapitalize="off"></div><small>Plusieurs adresses séparées par une virgule : essayées dans l'ordre. L'IP Tailscale fonctionne partout, PC allumé.</small></div>
      ${secretField("st-token", "Jeton d'appairage", "pc_token", "NK1.…", "Sur le PC : panneau SÉCURITÉ → copier le jeton.")}
      <div class="f"><label>Certificat du PC</label><div class="r"><span id="st-fp" style="flex:1;align-self:center;font-size:13px;word-break:break-all" class="${cfg.pinned ? "ok" : "muted"}">${cfg.pinned ? "✓ empreinte validée" : "non validée"}</span><button class="mini" id="st-fp-btn" style="margin:0">VÉRIFIER</button></div></div>

      <div class="row"><button class="btn pri" id="st-save">ENREGISTRER</button><button class="btn" id="st-import">IMPORTER DEPUIS LE PC</button></div>
      <p class="muted" style="margin-top:14px;font-size:12.5px">Version ${esc(N.version())} · les clés ne quittent jamais le coffre Android.</p>` });

    s.querySelectorAll("[data-replace]").forEach((b) => (b.onclick = () => { N.vault.del(b.dataset.replace); open(); }));
    s.querySelectorAll("[data-forget]").forEach((b) => (b.onclick = async () => { if (await U.confirm("Effacer ?", "La clé sera supprimée de ce téléphone.", "EFFACER", true)) { N.vault.del(b.dataset.forget); if (b.dataset.forget === "pc_token") N.pc.clear(); E.emit("settings", "pcPaired"); open(); } }));
    s.querySelectorAll("[data-voices]").forEach((b) => (b.onclick = () => pickVoice(b.dataset.voices, b.dataset.p)));
    $("#st-scan").onclick = () => { U.closeSheet(true); E.pairScan.open(); };
    $("#st-upd").onclick = async () => {
      const b = $("#st-upd"), m = $("#st-upd-msg");
      N.setWebUpdate($("#st-upd-br").value.trim() || "main", $("#st-upd-auto").checked);
      b.disabled = true; m.textContent = "Recherche de la dernière version…";
      const r = await N.webUpdate(true);
      b.disabled = false;
      if (r.state === "applied") m.textContent = "Mise à jour installée, rechargement…";
      else m.textContent = r.msg || r.error || "Terminé.";
    };
    $("#st-upd-auto").onchange = () => N.setWebUpdate($("#st-upd-br").value.trim() || "main", $("#st-upd-auto").checked);
    $("#st-fp-btn").onclick = verifyFp;
    $("#st-save").onclick = save;
    $("#st-import").onclick = () => { U.closeSheet(true); E.importer.paste(); };
    if (section === "pc") setTimeout(() => { const t = $("#st-pc"); if (t) t.scrollIntoView({ behavior: "smooth" }); }, 340);
  }

  async function save() {
    const g = (id) => ($("#" + id) ? $("#" + id).value.trim() : "");
    E.settings.set("name", g("st-name") || "Nassime");
    if ($("#st-anim")) { E.settings.set("anim", $("#st-anim").checked); U.applyAnim(); }
    if (g("st-model")) E.settings.set("model", g("st-model"));
    const pairs = [["st-groq", "groq"], ["st-el1", "eleven_enos"], ["st-el2", "eleven_eto"], ["st-zeus", "ics_zeus"], ["st-moodle", "ics_moodle"]];
    for (const [id, k] of pairs) {
      const v = g(id);
      if (!v) continue;
      if ((k === "ics_zeus" || k === "ics_moodle") && !/^https:\/\//.test(v)) { U.toast("Le lien doit commencer par https://", "warn"); return; }
      N.vault.set(k, v);
    }
    const tok = g("st-token");
    if (tok) { if (!/^NK1\./.test(tok)) { U.toast("Jeton invalide : il commence par NK1.", "warn"); return; } N.vault.set("pc_token", tok); }
    N.pc.setAddrs(g("st-addrs"));
    U.closeSheet();
    U.toast("Réglages enregistrés", "ok");
    E.emit("settings", "pcAddrs");
    E.agenda.refresh(true);
    E.views.renderDay();
  }

  async function pickVoice(provider, p) {
    if (!N.vault.has(provider)) return U.toast("Enregistre d'abord la clé ElevenLabs.", "warn");
    U.toast("Chargement des voix…");
    try {
      const r = await N.fetch({ provider, path: "/v1/voices", method: "GET" });
      if (r.status !== 200) throw new Error(r.status === 401 ? "Clé ElevenLabs refusée" : "Erreur " + r.status);
      const voices = (r.json().voices || []).map((v) => ({ id: v.voice_id, name: v.name }));
      if (!voices.length) throw new Error("Aucune voix sur ce compte");
      U.sheet({ title: "Choisis la voix", options: voices.slice(0, 40).map((v) => ({ label: v.name, fn: () => { E.settings.set("voice_" + p, v.id); E.settings.set("voice_name_" + p, v.name); U.toast("Voix « " + v.name + " » choisie", "ok"); } })) });
    } catch (e) { U.toast(e.message, "warn"); }
  }

  async function verifyFp() {
    const addrs = ($("#st-addrs").value || "").split(",")[0].trim();
    if (!addrs) return U.toast("Saisis l'adresse du PC.", "warn");
    N.pc.setAddrs($("#st-addrs").value.trim());
    U.toast("Lecture du certificat…");
    const r = await N.pc.fingerprint(addrs);
    if (r.error || !r.fp) return U.toast(r.error || "PC injoignable", "warn");
    const ok = await U.confirm("Empreinte du PC", "Compare avec celle affichée sur le PC (panneau SÉCURITÉ / Accès téléphone) :\n" + r.fp, "C'EST LA BONNE");
    if (ok) { N.pc.pin(addrs, r.fp); U.toast("Certificat validé", "ok"); E.emit("settings", "pcPaired"); }
  }

  E.settingsUi = { open };
  E.settingsInit = () => { $("#btn-settings").onclick = () => open(); };
})();
