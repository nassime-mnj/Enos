"use strict";
// Réglages > CLOUD & TÉLÉPHONE : compte Dual Pulse (presse-papiers universel téléphone ⇄ PC) et miroir du téléphone (scrcpy, ADB sans fil).
// Le mot de passe n'est jamais enregistré ; la synchro du presse-papiers est désactivée tant qu'on ne l'active pas, sens par sens.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  async function api(path, body) {
    const r = await fetch(path, { method: body !== undefined ? "POST" : "GET", headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const d = j && j.detail; const e = new Error(typeof d === "string" ? d : (d && d.detail) || "Erreur " + r.status); e.mfa = !!(d && d.mfa_required); throw e; }
    return j;
  }
  let needTotp = false, timer = 0;

  function card() {
    const p = document.querySelector('#rg [data-p="th"]');
    if (!p) return null;
    let c = $("cl-card");
    if (!c) { c = document.createElement("div"); c.className = "tm-card friends-ok"; c.id = "cl-card"; p.appendChild(c); }
    return c;
  }

  async function paint() {
    const c = card(); if (!c) return;
    let st, mi = null;
    try { st = await api("/api/cloud/status"); } catch (e) { return; }
    const isMirror = !c.classList.contains("no-mirror");
    try { mi = await api("/api/mirror/status"); } catch (e) { mi = null; }               // 403 pour Friends : section masquée
    const keep = c.querySelector("input:focus") ? c.querySelector("input:focus").id : "";
    c.innerHTML = `<h3>CLOUD &amp; TÉLÉPHONE <small>presse-papiers universel · miroir</small></h3>
      ${st.logged_in ? `<div class="tm-row"><span>Connecté : <b>${esc(st.user ? st.user.email : "")}</b> (${esc(st.user ? st.user.role : "")}) sur ${esc(st.url)}</span><button class="btn sm" id="cl-out" type="button">SE DÉCONNECTER</button></div>
        <label class="ac-toggle"><input type="checkbox" id="cl-up" ${st.clip_up ? "checked" : ""}> <span><b>PC → téléphone</b> : envoyer ce que je copie sur le PC (jamais le contenu d'un gestionnaire de mots de passe)</span></label>
        <label class="ac-toggle"><input type="checkbox" id="cl-down" ${st.clip_down ? "checked" : ""}> <span><b>Téléphone → PC</b> : recevoir dans le presse-papiers du PC ce que je copie sur le téléphone</span></label>
        <label class="ac-toggle"><input type="checkbox" id="cl-ag" ${st.agenda ? "checked" : ""}> <span><b>Agenda</b> : synchroniser mes tâches avec le téléphone via le cloud (stockées dans la base de ton compte)</span></label>
        <div class="tm-note" id="cl-note">${st.sync && st.sync.error ? "Dernière erreur : " + esc(st.sync.error) : st.sync && st.sync.running ? "Synchronisation active." : "Désactivée tant qu'aucun sens n'est coché."}</div>`
      : `<div class="tm-row"><input id="cl-url" type="text" placeholder="https://dualpulse.onrender.com" value="${esc(st.url)}" spellcheck="false" style="flex:2;min-width:220px"> <input id="cl-mail" type="text" placeholder="e-mail" autocomplete="username" style="flex:2;min-width:180px"> <input id="cl-pw" type="password" placeholder="mot de passe" autocomplete="current-password" style="flex:2;min-width:160px">
        ${needTotp ? '<input id="cl-totp" type="text" placeholder="code 6 chiffres" inputmode="numeric" maxlength="8" style="width:130px">' : ""} <button class="btn sm" id="cl-go" type="button">SE CONNECTER</button></div>
        <div class="tm-note" id="cl-note">Compte Dual Pulse (inscription sur invitation). Le mot de passe n'est pas enregistré, seulement une session révocable.</div>`}
      ${mi ? `<h3 style="margin-top:16px">MIROIR DU TÉLÉPHONE <small>scrcpy · ADB sans fil</small></h3>
        <label class="ac-toggle"><input type="checkbox" id="mi-auto" ${mi.auto ? "checked" : ""}> <span><b>Afficher l'écran du téléphone automatiquement</b> dès que j'allume E.N.O.S. (si le téléphone est sur le même Wi-Fi)</span></label>
        <div class="tm-row"><input id="mi-host" type="text" placeholder="IP du téléphone (facultatif)" value="${esc(mi.host)}" style="flex:2;min-width:180px"> <input id="mi-port" type="number" min="1" max="65535" value="${+mi.port || 5555}" style="width:100px"> <button class="btn sm" id="mi-start" type="button">AFFICHER</button> <button class="btn sm" id="mi-stop" type="button">ARRÊTER</button></div>
        <div class="tm-row"><input id="mi-pair-hp" type="text" placeholder="IP:port d'association" style="flex:2;min-width:180px"> <input id="mi-pair-code" type="text" placeholder="code 6 chiffres" maxlength="6" inputmode="numeric" style="width:130px"> <button class="btn sm" id="mi-pair" type="button">ASSOCIER</button></div>
        <div class="tm-note" id="mi-note"><b>${esc(mi.state)}</b> ${esc(mi.detail)} ${mi.adb ? "" : "· ADB introuvable (Android platform-tools)"} ${mi.scrcpy ? "" : "· scrcpy introuvable"}<br>Téléphone : Options pour développeurs → Débogage sans fil. Premier appairage : « Associer avec un code ». L'app mobile (compte cloud) annonce l'IP du téléphone au PC.</div>` : ""}`;
    if (keep && $(keep)) $(keep).focus();
    const note = (m) => { const n = $("cl-note"); if (n) n.textContent = m; };
    if ($("cl-go")) $("cl-go").onclick = async () => {
      try { note("Connexion… (le serveur gratuit peut mettre une minute à se réveiller)"); await api("/api/cloud/login", { url: $("cl-url").value, email: $("cl-mail").value, password: $("cl-pw").value, totp: $("cl-totp") ? $("cl-totp").value : "" }); needTotp = false; paint(); }
      catch (e) { if (e.mfa) { needTotp = true; const m = $("cl-mail").value, u = $("cl-url").value; await paint(); $("cl-mail").value = m; $("cl-url").value = u; note("Entre le code de ton application d'authentification."); } else note(e.message); }
    };
    if ($("cl-out")) $("cl-out").onclick = async () => { await api("/api/cloud/logout", {}); paint(); };
    const sync = () => api("/api/cloud/sync", { up: $("cl-up").checked, down: $("cl-down").checked, agenda: $("cl-ag").checked }).then(paint).catch((e) => note(e.message));
    if ($("cl-up")) { $("cl-up").onchange = sync; $("cl-down").onchange = sync; $("cl-ag").onchange = sync; }
    const mnote = (m) => { const n = $("mi-note"); if (n) n.textContent = m; };
    if ($("mi-auto")) $("mi-auto").onchange = () => api("/api/mirror/config", { auto: $("mi-auto").checked, host: $("mi-host").value, port: +$("mi-port").value || 5555 }).then(paint).catch((e) => mnote(e.message));
    if ($("mi-start")) $("mi-start").onclick = async () => { try { await api("/api/mirror/config", { host: $("mi-host").value, port: +$("mi-port").value || 5555 }); mnote("Connexion…"); await api("/api/mirror/start", {}); paint(); } catch (e) { mnote(e.message); } };
    if ($("mi-stop")) $("mi-stop").onclick = () => api("/api/mirror/stop", {}).then(paint);
    if ($("mi-pair")) $("mi-pair").onclick = async () => {
      const hp = $("mi-pair-hp").value.trim().split(":");
      try { mnote("Association…"); await api("/api/mirror/pair", { host: hp[0], port: +hp[1] || 0, code: $("mi-pair-code").value.trim() }); mnote("Téléphone associé. Tu peux cliquer sur AFFICHER."); } catch (e) { mnote(e.message); }
    };
  }

  function init() {
    const rg = $("rg"); if (!rg) return;
    const watch = () => { clearInterval(timer); if (rg.hidden) return; paint(); timer = setInterval(() => { if (rg.hidden) clearInterval(timer); else if (!document.activeElement || !$("cl-card") || !$("cl-card").contains(document.activeElement)) paint(); }, 4000); };
    new MutationObserver(watch).observe(rg, { attributes: true, attributeFilter: ["hidden"] });
    watch();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
