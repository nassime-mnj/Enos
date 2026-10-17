"use strict";
// API CONTROL PANEL : jauges de consommation des clés API (ElevenLabs, Groq, OpenAI, Claude…) + dates de reset. Le serveur ne renvoie jamais les clés.
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const CHIP = { ok: "EN LIGNE", warn: "ATTENTION", danger: "LIMITE PROCHE", offline: "HORS LIGNE", bad_key: "ERREUR DE CLÉ", estimate: "ESTIMATION", unconfigured: "NON CONFIGURÉ" };
  let timer = 0, tick = 0, lastAt = 0, busy = false;
  const isOpen = () => !$("ap").hidden;

  async function fetchCards(force) {
    const r = await fetch("/api/apimon" + (force ? "?force=1" : ""), { headers: { "X-Nasko-Token": TOKEN } });
    if (!r.ok) throw new Error(r.status === 403 ? "Accès refusé (panneau réservé à ce PC)." : "Serveur E.N.O.S. : erreur " + r.status);
    return r.json();
  }

  function cardState(c) {                                           // état global de la carte : le pire niveau de ses barres, sauf hors ligne / erreur de clé
    if (c.status === "offline" || c.status === "bad_key") return c.status;
    const lv = c.bars.map((b) => b.level);
    return lv.includes("danger") ? "danger" : lv.includes("warn") ? "warn" : c.status === "estimate" ? "estimate" : "ok";
  }

  function renderCard(c) {
    const st = cardState(c);
    const bars = c.bars.map((b) => `<div class="ap-bar" data-lv="${esc(b.level)}">
      <div class="ap-lab"><span>${esc(b.label)}</span><span>${Math.round(b.limit - b.used) >= 0 ? esc(Math.round(b.limit - b.used).toLocaleString("fr-FR")) + " restants" : "quota dépassé"}</span></div>
      <div class="ap-gauge"><div class="ap-fill" data-w="${b.pct}"></div><div class="ap-pct">${Math.round(b.pct)} %</div></div>
      <div class="ap-txt">${esc(c.label.split(" (")[0])} : ${esc(b.text)}</div></div>`).join("");
    const left = c.reset_iso ? Math.max(0, new Date(c.reset_iso).getTime() - Date.now()) : 0;
    return `<article class="ap-card" data-st="${esc(st)}">
      <div class="ap-head"><span class="ap-name">${esc(c.label)}</span><span class="ap-chip ${esc(st)}">${esc(CHIP[st] || st.toUpperCase())}</span></div>
      <div class="ap-src">Source : ${esc(c.source)}</div>
      ${c.error ? `<div class="ap-err">${esc(c.error)}</div>` : ""}
      ${bars}
      ${c.reset_text ? `<div class="ap-reset">⟳ <i>${esc(c.reset_text)}</i></div>` : ""}
      ${(c.lines || []).map((l) => `<div class="ap-line">${esc(l)}</div>`).join("")}
    </article>`;
  }

  function render(data) {
    const body = $("ap-cards");
    const cards = data.cards || [];
    body.innerHTML = (data.error ? `<div class="ap-banner">⚠ ${esc(data.error)}</div>` : "") +
      (cards.length ? cards.map(renderCard).join("") : `<div class="ap-empty">Aucune clé API configurée dans nasko_config.json.<br>Ajoutez-en une (elevenlabs_api_key, llm_api_key…) puis actualisez.</div>`);
    requestAnimationFrame(() => requestAnimationFrame(() => body.querySelectorAll(".ap-fill").forEach((f) => (f.style.width = Math.min(100, +f.dataset.w) + "%"))));   // les jauges se remplissent en douceur
    lastAt = Date.now(); paintAge();
  }

  function paintAge() {
    if (!lastAt) return;
    const s = Math.round((Date.now() - lastAt) / 1000);
    $("ap-upd").textContent = "Mis à jour il y a " + (s < 2 ? "un instant" : s + " s");
  }

  async function load(force) {
    if (busy) return;
    busy = true; $("ap-refresh").disabled = true; $("ap-refresh").textContent = "⟳ …";
    try { render(await fetchCards(force)); }
    catch (e) {                                                      // serveur injoignable : on garde l'écran, on l'indique, rien ne plante
      $("ap-cards").insertAdjacentHTML("afterbegin", `<div class="ap-banner">⚠ Hors ligne : ${esc(e.message)}</div>`);
    }
    busy = false; $("ap-refresh").disabled = false; $("ap-refresh").textContent = "⟳ ACTUALISER";
  }

  function open() {
    $("ap").hidden = false;
    load(true);
    clearInterval(timer); clearInterval(tick);
    timer = setInterval(() => isOpen() && load(false), 60000);       // rafraîchissement automatique toutes les minutes
    tick = setInterval(paintAge, 1000);
  }
  function close() { $("ap").hidden = true; clearInterval(timer); clearInterval(tick); }

  function init() {
    if (!$("b-api")) return;
    $("b-api").onclick = open;
    $("ap-close").onclick = close;
    $("ap-refresh").onclick = () => load(true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) close(); });
  }
  init();
})();
