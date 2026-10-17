"use strict";
// SÉCURITÉ : panneau local (clé d'appairage pour l'APK, protections actives, journal, dossiers autorisés).
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const api = async (p, o = {}) => {
    const r = await fetch(p, { ...o, headers: { "Content-Type": "application/json" } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
    return r.json();
  };
  let token = "", shown = false, timer = 0, rotArm = 0;
  const isOpen = () => !$("se").hidden;
  const when = (t) => new Date(t * 1000).toLocaleTimeString("fr-FR");

  function renderToken() {
    $("se-tok").textContent = shown ? token : token.replace(/^(NK1\.).*$/, "$1") + "•".repeat(40);
    $("se-tok").classList.toggle("on", shown);
    $("se-show").textContent = shown ? "MASQUER" : "AFFICHER";
  }

  async function refresh() {
    let st;
    try { st = await api("/api/security/status"); } catch (e) { return; }
    $("se-fp").textContent = "empreinte " + st.fingerprint;
    $("se-created").textContent = st.created ? "Créée le " + st.created.replace("T", " à ") + " · stockée chiffrée (DPAPI) : " + (st.key_file || "") : "";
    $("se-enc").checked = !!st.enc_required_remote; $("se-inj").checked = !!st.inject_remote;
    const live = st.alert && st.alert.live;
    $("se-state").className = live ? "bad" : "ok";
    $("se-state").textContent = live ? "⚠ ALERTE EN COURS" : "● PROTÉGÉ";
    const roots = st.roots || [];
    $("se-prot").innerHTML = [
      ["ok", "Authentification par clé d'API (Bearer 256 bits)", "401 immédiat sans clé · comparaison en temps constant"],
      ["ok", "Confinement des chemins", `${roots.length} dossiers autorisés · System32, AppData, .ssh… toujours refusés`],
      [st.enc_required_remote ? "ok" : "mid", "Chiffrement AES-256-GCM des échanges mobile ⇄ PC", st.enc_required_remote ? "obligatoire pour tout appareil distant" : "actif pour l'APK appairée (non imposé aux navigateurs)"],
      ["ok", `Limiteur de débit : ${st.limit} requêtes/s`, "au-delà : source coupée + alerte rouge"],
      ["ok", "Clé jamais servie en HTTP au PC", "remise à la fenêtre native par le pont interne"],
    ].map(([c, t, d]) => `<li class="${c}"><i></i><div><b>${esc(t)}</b><small>${esc(d)}</small></div></li>`).join("");
    const s = st.stats || {};
    $("se-cnt").innerHTML = [["401 REFUSÉES", s.unauthorized], ["COUPURES DE DÉBIT", s.blocked], ["CHEMINS HOSTILES", s.hostile_paths], ["CHEMINS REFUSÉS", s.path_denied], ["CHIFFREMENT REFUSÉ", s.crypto_errors]]
      .map(([l, v]) => `<div class="${v ? "hot" : ""}"><b>${v || 0}</b><small>${l}</small></div>`).join("");
    const ev = st.events || [];
    $("se-ev").innerHTML = ev.length ? `<table>${ev.map((e) => `<tr><td>${when(e.t)}</td><td class="k">${esc(e.kind)}</td><td>${esc(e.ip)}</td><td>${esc(e.path)}</td><td>${esc(e.detail)}</td></tr>`).join("")}</table>` : '<div class="none">Aucune tentative bloquée depuis le démarrage.</div>';
    $("se-roots").innerHTML = roots.map((r) => `<li>${esc(r)}</li>`).join("");
  }

  async function open() {
    $("se").hidden = false; document.body.classList.remove("menu-open");
    try { const p = await api("/api/security/pairing"); token = p.token; $("se-qr").src = p.qr; } catch (e) { token = ""; }
    shown = false; $("se-qr").hidden = true; renderToken(); refresh();
    clearInterval(timer); timer = setInterval(() => isOpen() && refresh(), 2500);
  }
  function close() { $("se").hidden = true; clearInterval(timer); shown = false; token = ""; $("se-tok").textContent = ""; }

  function init() {
    if (!$("b-se")) return;
    $("b-se").onclick = open; $("se-close").onclick = close;
    $("se-show").onclick = () => { shown = !shown; renderToken(); };
    $("se-copy").onclick = async () => { try { await navigator.clipboard.writeText(token); $("se-copy").textContent = "COPIÉ ✔"; } catch (e) { shown = true; renderToken(); $("se-copy").textContent = "SÉLECTIONNEZ ET COPIEZ"; } setTimeout(() => ($("se-copy").textContent = "COPIER"), 2200); };
    $("se-qrb").onclick = () => { $("se-qr").hidden = !$("se-qr").hidden; };
    const cfg = (k) => (e) => api("/api/security/config", { method: "POST", body: JSON.stringify({ [k]: e.target.checked }) }).then(refresh).catch(() => (e.target.checked = !e.target.checked));
    $("se-enc").onchange = cfg("enc_required_remote"); $("se-inj").onchange = cfg("api_key_inject_remote");
    $("se-rot").onclick = async () => {                                   // confirmation en deux clics
      const b = $("se-rot");
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "CONFIRMER : TOUS LES APPAREILS SERONT DÉCONNECTÉS"; rotArm = setTimeout(() => { b.classList.remove("armed"); b.textContent = "RÉGÉNÉRER LA CLÉ"; }, 5000); return; }
      clearTimeout(rotArm); b.classList.remove("armed"); b.textContent = "RÉGÉNÉRER LA CLÉ";
      try { const r = await api("/api/security/rotate", { method: "POST" }); token = r.token; await window.naskoSec.reload(); shown = true; renderToken(); refresh(); } catch (e) { $("se-rot").textContent = "ÉCHEC : " + e.message; }
    };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) close(); });
  }
  init();
})();
