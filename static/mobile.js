"use strict";
// CONTRÔLE MOBILE : adb local (écran, YouTube, swipe), miroir scrcpy, et champ « ID ADB » des réglages (profil actif).
// Toutes les requêtes visent /api/mobile/* (PC uniquement) ; rien ne passe par l'entrepôt.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (p, o = {}) => {
    const r = await fetch(p, { ...o, headers: { "Content-Type": "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || r.statusText);
    return j;
  };
  const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b || {}) });
  const bad = (m) => `<div class="gt-msg bad">✕ ${esc(m)}</div>`, good = (m) => `<div class="gt-msg ok">✓ ${esc(m)}</div>`;
  let timer = null;

  function paint(st) {
    const k = st.adb && st.device_id && st.state === "device" ? "on" : "off";
    $("mob-state").dataset.s = k;
    $("mob-label").textContent = !st.adb ? "ADB ABSENT" : !st.device_id ? "AUCUN APPAREIL CIBLÉ"
      : st.state === "device" ? "CONNECTÉ" + (st.model ? " · " + st.model : "") : st.state === "unauthorized" ? "NON AUTORISÉ" : st.state === "offline" ? "HORS LIGNE" : "ABSENT";
    $("mob-text").innerHTML = (st.device_id ? `Appareil ciblé : <b>${esc(st.device_id)}</b>. ` : "ID ADB non renseigné : <b>RÉGLAGES → PROFIL → TÉLÉPHONE</b>. ")
      + (!st.adb ? esc(st.how_adb) : st.state === "unauthorized" ? "Acceptez « Autoriser le débogage USB » sur le téléphone." : "")
      + (st.download && st.download.busy ? ` Téléchargement ${esc(st.download.busy)} : ${Math.round(st.download.pct * 100)} %` : "");
    $("mob-install").hidden = st.adb;
    $("mob-mirror").firstChild.textContent = st.mirroring ? "MIROIR AFFICHÉ" : "AFFICHER L'ÉCRAN";
  }
  async function refresh() { try { paint(await api("/api/mobile/status")); } catch (e) { $("mob-msg").innerHTML = bad(e.message); } }
  const stop = () => { clearInterval(timer); timer = null; };

  async function act(btn, call, okMsg) {
    if (btn.classList.contains("busy")) return;
    $("mob-amsg").innerHTML = ""; btn.classList.add("busy");
    const poll = setInterval(refresh, 800);                           // progression d'un éventuel téléchargement (adb / scrcpy)
    try { const r = await call(); $("mob-amsg").innerHTML = good(okMsg || r.label || "OK"); }
    catch (e) { $("mob-amsg").innerHTML = bad(e.message); }
    clearInterval(poll); btn.classList.remove("busy"); refresh();
  }

  function initPanel() {
    $("b-mob").onclick = () => { $("mob-msg").innerHTML = ""; $("mob-amsg").innerHTML = ""; $("mob").hidden = false; document.body.classList.remove("menu-open"); refresh(); stop(); timer = setInterval(refresh, 4000); };
    $("mob-close").onclick = () => { $("mob").hidden = true; stop(); };
    $("mob-refresh").onclick = refresh;
    $("mob-install").onclick = () => act($("mob-install"), () => post("/api/mobile/install"), "ADB installé");
    document.querySelectorAll("[data-mob]").forEach((b) => (b.onclick = () => act(b, () => post("/api/mobile/action", { action: b.dataset.mob }))));
    $("mob-mirror").onclick = () => act($("mob-mirror"), () => post("/api/mobile/mirror"));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("mob").hidden) $("mob-close").click(); });
  }

  // ---- réglages : ID ADB du profil actif
  function initSettings() {
    const inp = $("rg-adb"), err = $("rg-adb-err"), list = $("rg-adb-list");
    const load = async () => { try { const s = await api("/api/mobile/status"); inp.value = s.device_id || ""; } catch (e) { err.textContent = e.message; } };
    $("b-rg").addEventListener("click", load);
    $("rg-adb-save").onclick = async () => {
      err.textContent = "";
      try { const s = await post("/api/mobile/device", { device_id: inp.value }); inp.value = s.device_id; err.innerHTML = `<span class="tm-ok">${s.device_id ? "ID enregistré dans le profil actif." : "ID effacé : le contrôle mobile est désactivé."}</span>`; }
      catch (e) { err.textContent = e.message; }
    };
    $("rg-adb-detect").onclick = async () => {
      err.textContent = ""; list.innerHTML = "";
      try {
        const s = await api("/api/mobile/status");
        if (!s.adb) { err.textContent = "adb.exe est absent : ouvrez CONTRÔLE MOBILE → TÉLÉCHARGER ADB. " + s.how_adb; return; }
        if (!s.devices.length) { list.innerHTML = `<div class="tm-empty">Aucun appareil détecté (USB branché, débogage USB activé ?).</div>`; return; }
        list.innerHTML = s.devices.map((d) => `<div class="tm-item" data-id="${esc(d.id)}"><div class="grow"><b>${esc(d.id)}</b><br><small>${esc(d.model || "modèle inconnu")} · ${esc(d.state)} — cliquer pour utiliser cet ID</small></div></div>`).join("");
        list.querySelectorAll(".tm-item").forEach((x) => (x.onclick = () => { inp.value = x.dataset.id; }));
      } catch (e) { err.textContent = e.message; }
    };
  }

  initPanel(); initSettings();
})();
