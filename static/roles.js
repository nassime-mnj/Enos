"use strict";
// PROFILS D'UTILISATION : choix du profil au lancement (CEO / Dev / Friends, code pour CEO et Dev), masquage de secours, carte dans les Réglages.
// Le masquage proprement dit est fait en CSS (static/roles.css) d'après <body class="role-…"> posé par le serveur ; la garde réelle est côté serveur.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let role = "", info = null;                                                  // le script est chargé dans <head> : <body> n'existe pas encore (voir init)

  // Garde de secours : sans profil complet, tout module du menu qui n'est pas explicitement « friends-ok » est caché (un futur module oublié n'apparaît pas par erreur).
  function failClosed() {
    if (role === "ceo" || role === "dev") return;
    document.querySelectorAll('#side button.btn[id^="b-"], #side button.btn[data-open-colis]').forEach((b) => { if (!b.classList.contains("friends-ok")) b.hidden = true; });
  }

  async function api(path, body) {
    const r = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) { let d = r.statusText; try { d = (await r.json()).detail || d; } catch (e) {} throw new Error(typeof d === "string" ? d : "requête refusée"); }
    return r.json();
  }

  // ------------------------------------------------------------------ sélecteur
  function build() {
    if ($("rl")) return $("rl");
    const d = document.createElement("div");
    d.id = "rl"; d.hidden = true; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "Choix du profil");
    document.body.appendChild(d);
    return d;
  }
  function close() { const d = $("rl"); if (d) d.hidden = true; }

  function showCards(forced) {
    const d = build(); d.hidden = false;
    d.innerHTML = `<div class="rl-box"><h2>QUEL PROFIL ?</h2><p class="rl-sub">${forced ? "Choisissez comment utiliser E.N.O.S. sur ce PC." : "Changer de profil recharge l'application."}</p>
      <div class="rl-cards">${info.roles.map((r) => `<button class="rl-card${info.role === r.id ? " cur" : ""}" data-r="${r.id}"><em>${r.pin ? "CODE REQUIS" : "LIBRE"}</em><b>${esc(r.label.toUpperCase())}</b><small>${esc(r.description)}</small></button>`).join("")}</div>
      ${forced ? "" : '<div class="rl-row" style="margin-top:18px"><button class="rl-b ghost" id="rl-x">ANNULER</button></div>'}</div>`;
    d.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => pick(b.dataset.r)));
    if ($("rl-x")) $("rl-x").onclick = close;
  }

  function pick(r) {
    const meta = info.roles.find((x) => x.id === r);
    if (!meta.pin) return submit(r, "", "");
    const first = !info.pins_set[r], d = $("rl");
    d.innerHTML = `<div class="rl-box"><h2>${esc(meta.label.toUpperCase())}</h2><div class="rl-pin">
      <p>${first ? "Première utilisation : créez un code personnel (4 caractères minimum). Il sera demandé pour revenir à ce profil." : "Entrez votre code."}</p>
      <input type="password" id="rl-pin" autocomplete="off" maxlength="64" placeholder="••••" aria-label="Code">${first ? '<input type="password" id="rl-pin2" autocomplete="off" maxlength="64" placeholder="confirmer" aria-label="Confirmer le code">' : ""}
      <div class="rl-err" id="rl-err"></div><div class="rl-row"><button class="rl-b ghost" id="rl-back">RETOUR</button><button class="rl-b" id="rl-ok">VALIDER</button></div></div></div>`;
    const go = () => {
      const p = $("rl-pin").value;
      if (first) { if (p !== $("rl-pin2").value) return ($("rl-err").textContent = "Les deux codes sont différents."); submit(r, "", p); } else submit(r, p, "");
    };
    $("rl-ok").onclick = go; $("rl-back").onclick = () => showCards(info.needs_setup);
    d.querySelectorAll("input").forEach((i) => (i.onkeydown = (e) => { if (e.key === "Enter") go(); }));
    $("rl-pin").focus();
  }

  async function submit(r, pin, newPin) {
    try { await api("/api/role/select", { role: r, pin, new_pin: newPin }); location.reload(); }
    catch (e) { const el = $("rl-err"); if (el) el.textContent = e.message; else alert(e.message); }
  }

  // ------------------------------------------------------------------ carte « PROFIL D'UTILISATION » des Réglages
  function injectCard() {
    const host = document.querySelector('#rg [data-p="th"]');
    if (!host || $("rl-card")) return;
    const c = document.createElement("div");
    c.className = "tm-card local-only"; c.id = "rl-card";
    c.innerHTML = `<h3>PROFIL D'UTILISATION <small>ce que cette installation affiche et autorise</small></h3><div class="rl-cur" id="rl-cur">…</div>
      <div class="tm-row"><button class="btn sm" id="rl-change" type="button">CHANGER DE PROFIL</button><button class="btn sm" id="rl-pinbtn" type="button">CHANGER MON CODE</button></div><div class="tm-note" id="rl-note"></div>`;
    host.insertBefore(c, host.firstChild);
    $("rl-change").onclick = () => info && showCards(false);
    $("rl-pinbtn").onclick = changePin;
  }
  function paintCard() {
    if (!info || !$("rl-cur")) return;
    const lab = info.role ? info.label : "aucun";
    $("rl-cur").innerHTML = `Profil actif : <b>${esc(lab.toUpperCase())}</b> — ${esc((info.roles.find((r) => r.id === info.role) || { description: "choisissez un profil" }).description)}`;
    $("rl-pinbtn").hidden = !(info.role === "ceo" || info.role === "dev");
  }
  async function changePin() {
    const r = info.role, oldp = prompt("Code actuel :"); if (oldp == null) return;
    const np = prompt("Nouveau code (4 caractères minimum) :"); if (np == null) return;
    try { await api("/api/role/pin", { role: r, pin: oldp, new_pin: np }); $("rl-note").textContent = "Code modifié."; } catch (e) { $("rl-note").textContent = e.message; }
  }

  async function init() {
    role = document.body.dataset.role || "";
    window.ENOS_ROLE = role;
    failClosed();
    try { await (window.naskoSec ? window.naskoSec.ready() : 0); } catch (e) {}
    try { info = await api("/api/role"); } catch (e) { return; }
    window.enosRole = info;
    injectCard(); paintCard();
    if (info.needs_setup && !document.body.classList.contains("remote")) showCards(true);
    window.dispatchEvent(new CustomEvent("enos:role", { detail: info }));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
