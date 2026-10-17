"use strict";
// Réglages « ARRIÈRE-PLAN & NOTIFICATIONS » : icône de la zone de notification, démarrage avec Windows, briefing quotidien, ne pas déranger.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  async function api(path, body) {
    const r = await fetch(path, { method: body !== undefined ? "POST" : "GET", headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (!r.ok) { let d = r.statusText; try { d = (await r.json()).detail || d; } catch (e) {} throw new Error(typeof d === "string" ? d : "requête refusée"); }
    return r.json();
  }
  let S = null;

  function inject() {
    const host = document.querySelector('#rg [data-p="th"]');
    if (!host || $("bg-card")) return !!$("bg-card");
    const c = document.createElement("div");
    c.className = "tm-card local-only"; c.id = "bg-card";
    c.innerHTML = `<h3>ARRIÈRE-PLAN &amp; NOTIFICATIONS <small>E.N.O.S. veille sans fenêtre et vous prévient discrètement</small></h3>
      <div class="bg-grid">
        <label class="bg-chk"><input type="checkbox" id="bg-tray"> Garder E.N.O.S. actif dans la zone de notification quand je ferme la fenêtre</label>
        <label class="bg-chk"><input type="checkbox" id="bg-auto"> Lancer E.N.O.S. au démarrage de Windows (sans fenêtre)</label>
        <label class="bg-chk"><input type="checkbox" id="bg-brief"> Briefing quotidien silencieux à <input type="time" id="bg-time" step="300"></label>
      </div>
      <div class="tm-row" style="margin-top:10px"><b style="letter-spacing:2px;font-size:11px">NE PAS DÉRANGER</b>
        <button class="btn sm" data-pause="60" type="button">1 H</button><button class="btn sm" data-pause="240" type="button">4 H</button><button class="btn sm" data-pause="720" type="button">12 H</button><button class="btn sm" data-pause="0" type="button">RÉACTIVER</button></div>
      <div class="tm-row" style="margin-top:10px"><button class="btn sm" id="bg-test" type="button">TESTER UNE NOTIFICATION</button><button class="btn sm" id="bg-now" type="button">BRIEFING MAINTENANT</button></div>
      <div class="tm-note" id="bg-note"></div>`;
    const first = host.querySelector(".tm-card");
    host.insertBefore(c, first ? first.nextSibling : null);
    $("bg-tray").onchange = () => save({ tray_enabled: $("bg-tray").checked }, "Pris en compte au prochain lancement d'E.N.O.S.");
    $("bg-auto").onchange = () => save({ autostart: $("bg-auto").checked });
    $("bg-brief").onchange = () => save({ briefing_enabled: $("bg-brief").checked });
    $("bg-time").onchange = () => $("bg-time").value && save({ briefing_time: $("bg-time").value });
    c.querySelectorAll("[data-pause]").forEach((b) => (b.onclick = () => save({ pause_minutes: +b.dataset.pause })));
    $("bg-test").onclick = async () => { try { await api("/api/background/test", {}); note("Carte de test envoyée : regardez en bas à droite de l'écran."); } catch (e) { note(e.message); } };
    $("bg-now").onclick = async () => { try { const r = await api("/api/agent/run?brief=true", {}); note(r.sent ? "Briefing envoyé." : "Rien à envoyer."); } catch (e) { note(e.message); } };
    return true;
  }
  function note(t) { const n = $("bg-note"); if (n) n.textContent = t; }

  function paint() {
    if (!S || !$("bg-card")) return;
    $("bg-tray").checked = S.tray_enabled; $("bg-tray").disabled = !S.tray_available && !S.tray_enabled;
    $("bg-auto").checked = !!S.autostart; $("bg-auto").disabled = !S.windows;
    $("bg-brief").checked = S.briefing_enabled; $("bg-time").value = S.briefing_time;
    const bits = [];
    bits.push(S.tray_active ? "Icône de la zone de notification : active." : S.tray_available ? "Icône de la zone de notification : inactive (relancez E.N.O.S.)." : "Icône de la zone de notification : indisponible (Windows et pystray requis).");
    if (!S.windows) bits.push("Le démarrage automatique n'existe que sous Windows.");
    if (S.paused_until) bits.push("Ne pas déranger jusqu'à " + new Date(S.paused_until * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) + ".");
    note(bits.join(" "));
  }
  async function refresh() { try { S = await api("/api/background/settings"); paint(); } catch (e) { note(e.message); } }
  async function save(body, extra) { try { S = await api("/api/background/settings", body); paint(); if (extra) note($("bg-note").textContent + " " + extra); } catch (e) { note(e.message); await refresh(); } }

  function init() {
    if (!inject()) return;
    const b = $("b-rg"); if (b) b.addEventListener("click", refresh);
    refresh();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
