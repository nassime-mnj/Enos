"use strict";
// COMPTE CLOUD & MISES À JOUR : connexion au serveur Dual Pulse (invitation requise pour s'inscrire), mises à jour de l'application sans PC, appareil visible du PC.
(() => {
  const E = window.ENOS, esc = E.esc;
  E.suite.register({
    id: "cloud", group: "sync", title: "Compte cloud", sub: "Mises à jour · liaison PC",
    icon: '<path d="M18 10a6 6 0 0 0-11.6-1.5A4.5 4.5 0 0 0 7 18h11a4 4 0 0 0 0-8z"/>',
    build(el, A) {
      let mode = "login", needTotp = false;
      const C = E.cloud;
      const $ = (s) => el.querySelector(s);
      const draw = () => {
        const u = C.user();
        el.innerHTML = `<div class="card"><h3>Serveur Dual Pulse</h3>
          <input type="text" id="cl-url" placeholder="https://dualpulse.onrender.com" value="${esc(C.url())}" spellcheck="false" autocapitalize="off" aria-label="Adresse du serveur">
          <p class="muted" style="font-size:12.5px">Le serveur héberge tes mises à jour et le presse-papiers universel. Aucun mot de passe n'est enregistré : seule une session révocable est gardée dans le coffre Android.</p></div>
          ${C.loggedIn() ? `<div class="card"><h3>Mon compte<span class="sp">${esc(({ ceo: "CEO", dev: "Dev", friends: "Friends" })[u.role] || u.role || "")}</span></h3>
            <p><b>${esc(u.name || u.email)}</b><br><span class="muted">${esc(u.email)}</span></p>
            <div class="row"><button class="btn pri" id="cl-update">VÉRIFIER LES MISES À JOUR</button><button class="btn" id="cl-out">SE DÉCONNECTER</button></div>
            <label class="chip2" style="margin-top:10px;display:inline-flex;gap:8px"><input type="checkbox" id="cl-auto" ${E.settings.get("autoUpdate", true) ? "checked" : ""}> Vérifier automatiquement (toutes les 6 h)</label>
            <label class="chip2" style="margin-top:10px;display:inline-flex;gap:8px"><input type="checkbox" id="cl-agsync" ${E.settings.get("cloudAgenda", false) ? "checked" : ""}> Synchroniser mon agenda via le cloud (PC allumé ou non)</label>
            <p class="muted" style="font-size:12.5px;margin-top:8px">Version installée : ${esc(E.native.version())}. L'installation passe par le installateur d'Android (même signature exigée : une fausse application est refusée par le système).</p></div>
            <div class="card"><h3>Visible depuis le PC</h3>
              <p class="muted" style="font-size:12.5px">Ton téléphone annonce son nom et ses adresses Wi-Fi à ton compte pour que le PC puisse afficher son écran (scrcpy, ADB sans fil).</p>
              <div class="row"><input type="text" id="cl-dname" maxlength="40" placeholder="Nom du téléphone" value="${esc(E.settings.get("deviceName", ""))}" aria-label="Nom du téléphone"><input type="number" id="cl-adb" min="1" max="65535" value="${+E.settings.get("adbPort", 5555) || 5555}" aria-label="Port ADB"></div>
              <button class="btn wide" id="cl-beat" style="margin-top:8px">ANNONCER MAINTENANT</button>
              <p class="muted" style="font-size:12.5px;margin-top:8px">Active « Débogage sans fil » dans Options pour développeurs (Android 11+), puis note le port affiché.</p></div>`
          : `<div class="card"><h3>Connexion</h3>
            <div class="tabs2" style="display:flex;gap:6px;margin-bottom:10px"><button class="btn ${mode === "login" ? "pri" : ""}" id="cl-tl" style="flex:1">CONNEXION</button><button class="btn ${mode === "reg" ? "pri" : ""}" id="cl-tr" style="flex:1">J'AI UNE INVITATION</button></div>
            ${mode === "reg" ? `<input type="text" id="cl-inv" placeholder="Code d'invitation DP-…" autocapitalize="characters" spellcheck="false" aria-label="Code d'invitation"><p class="muted" style="font-size:12.5px;margin:6px 0">L'inscription est réservée aux personnes invitées.</p>` : ""}
            <input type="email" id="cl-mail" placeholder="E-mail" autocomplete="username" aria-label="E-mail" style="margin-top:8px">
            <input type="password" id="cl-pw" placeholder="Mot de passe (10 caractères minimum)" autocomplete="${mode === "reg" ? "new-password" : "current-password"}" aria-label="Mot de passe" style="margin-top:8px">
            ${needTotp ? `<input type="text" id="cl-totp" inputmode="numeric" maxlength="8" placeholder="Code à 6 chiffres" aria-label="Code de double authentification" style="margin-top:8px">` : ""}
            <p class="err" id="cl-err" hidden role="alert"></p>
            <button class="btn pri wide" id="cl-go" style="margin-top:10px">${mode === "reg" ? "CRÉER MON COMPTE" : "SE CONNECTER"}</button></div>`}`;
        $("#cl-url").onchange = (e) => { try { C.setUrl(e.target.value); A.toast("Serveur enregistré.", "ok"); } catch (x) { A.toast(x.message, "err"); } };
        if (C.loggedIn()) {
          $("#cl-update").onclick = async () => { try { await C.checkUpdate(true); } catch (x) { A.toast(x.message, "err"); } };
          $("#cl-out").onclick = async () => { await C.logout(); draw(); };
          $("#cl-auto").onchange = (e) => E.settings.set("autoUpdate", e.target.checked);
          $("#cl-agsync").onchange = (e) => { E.settings.set("cloudAgenda", e.target.checked); if (e.target.checked) { E.store.set("cloud.agSince", 0); C.syncAgenda().then(() => A.toast("Agenda synchronisé.", "ok")).catch((x) => A.toast(x.message, "err")); } };
          $("#cl-beat").onclick = async () => {
            E.settings.set("deviceName", $("#cl-dname").value.trim()); E.settings.set("adbPort", +$("#cl-adb").value || 5555);
            try { A.toast((await C.beat()) ? "Annoncé : le PC peut te voir." : "Annonce refusée.", (await C.beat()) ? "ok" : "err"); } catch (x) { A.toast(x.message, "err"); }
          };
        } else {
          $("#cl-tl").onclick = () => { mode = "login"; needTotp = false; draw(); };
          $("#cl-tr").onclick = () => { mode = "reg"; needTotp = false; draw(); };
          $("#cl-go").onclick = async () => {
            const err = (m) => { $("#cl-err").hidden = !m; $("#cl-err").textContent = m || ""; };
            err("");
            try {
              if ($("#cl-url").value.trim() && $("#cl-url").value.trim() !== C.url()) C.setUrl($("#cl-url").value);
              if (!C.url()) throw new Error("Indique l'adresse du serveur.");
              const mail = $("#cl-mail").value.trim(), pw = $("#cl-pw").value;
              if (!mail || !pw) throw new Error("Renseigne l'e-mail et le mot de passe.");
              $("#cl-go").disabled = true; A.toast("Connexion… (le serveur gratuit peut mettre une minute à se réveiller)");
              if (mode === "reg") await C.register(($("#cl-inv").value || "").trim(), mail, pw, "");
              else await C.login(mail, pw, needTotp ? $("#cl-totp").value : "");
              needTotp = false; A.toast("Connecté.", "ok"); draw();
              C.updateSetup().catch(() => {}); C.beat().catch(() => {});
            } catch (x) {
              if (x.extra && x.extra.mfa_required) { needTotp = true; const m = $("#cl-mail").value, p = $("#cl-pw").value; draw(); $("#cl-mail").value = m; $("#cl-pw").value = p; $("#cl-err").hidden = false; $("#cl-err").textContent = "Entre le code de ton application d'authentification."; return; }
              err(x.message); const g = $("#cl-go"); if (g) g.disabled = false;
            }
          };
        }
      };
      draw();
      E.on("cloud", () => { if (!el.closest(".subview").hidden) draw(); });
    },
  });
})();
