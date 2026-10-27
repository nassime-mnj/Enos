"use strict";
// ÉQUIPE : édition (Eto / Eto Dev / E.N.O.S.), RÉGLAGES (thèmes, profil, appareils de confiance), HUB ÉQUIPE (entrepôt, chat, git).
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
  const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(n / 1024)) + " Ko");
  const ago = (t) => { const s = Date.now() / 1000 - t; return s < 60 ? "à l'instant" : s < 3600 ? Math.round(s / 60) + " min" : s < 86400 ? Math.round(s / 3600) + " h" : Math.round(s / 86400) + " j"; };
  const E = { edition: "eto", local: false, brand: "Eto", user: { id: "", label: "" } };
  const isDev = () => E.edition === "dev";
  const tabs = (nav, wrap, cb) => {                                   // onglets génériques
    nav.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-t]"); if (!b) return;
      nav.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      wrap.querySelectorAll("[data-p]").forEach((p) => (p.hidden = p.dataset.p !== b.dataset.t));
      cb && cb(b.dataset.t);
    });
  };
  const showTab = (nav, t) => { const b = nav.querySelector(`button[data-t="${t}"]`); if (b) b.click(); };
  const open = (id) => { $(id).hidden = false; document.body.classList.remove("menu-open"); };
  const bodyOf = (id) => $(id).querySelector(".tm-body");

  // ============================================================== édition + identité
  function applyEdition() {
    document.body.classList.toggle("ed-dev", isDev());
    document.documentElement.style.setProperty("--brand", JSON.stringify(E.brand === "E.N.O.S." ? "E.N.O.S" : E.brand));
    document.title = E.brand;
    const sh = document.querySelector(".ch-short"); if (sh) sh.textContent = E.brand;
  }
  function applyUser() {
    const n = ((window.enosUser === undefined ? E.user.label : window.enosUser) || "Vous").toUpperCase();
    const l = $("u-label"); if (l) l.textContent = n + " ▸";
    document.querySelectorAll(".u-label").forEach((x) => (x.textContent = n + " ▸"));
  }
  window.addEventListener("enos-user", applyUser);

  // ---- langue de l'assistant (Français / English) : appliquée au serveur (texte, voix, réflexes, micro) et au micro du navigateur
  function initWelcome() {
    const sel = $("rg-welcome"); if (!sel) return;
    sel.value = E.welcome_language || "fr";
    sel.onchange = async () => {
      try { await post("/api/settings/welcome", { welcome_language: sel.value }); E.welcome_language = sel.value;
        $("rg-welcome-note").textContent = sel.value === "off" ? "Aucune phrase au lancement." : "Enregistré : cette phrase sera jouée au prochain lancement. La première écoute est générée une fois, puis conservée."; }
      catch (e) { $("rg-welcome-note").textContent = e.message; sel.value = E.welcome_language || "fr"; }
    };
    $("rg-welcome-test").onclick = async () => {
      const l = sel.value === "off" ? (E.welcome_language === "en" ? "en" : "fr") : sel.value;
      $("rg-welcome-note").textContent = "Préparation de la phrase…";
      try { const r = await api("/api/settings/welcome/preview?lang=" + l); $("rg-welcome-note").textContent = ""; if (window.say) window.say(r.text, { audio: r.audio }); }
      catch (e) { $("rg-welcome-note").textContent = e.message; }
    };
  }
  function initLang() {
    initWelcome();
    window.enosLang = E.language || "fr";
    const sel = $("rg-lang"); if (!sel) return;
    sel.value = window.enosLang;
    sel.onchange = async () => {
      try { await post("/api/settings/language", { language: sel.value }); window.enosLang = sel.value; E.language = sel.value;
        $("rg-lang-note").textContent = sel.value === "en" ? "English selected: replies, reflex phrases and the microphone now use English. The first time each reflex phrase is spoken it is generated once, then kept." : "Français sélectionné : réponses, phrases réflexes et micro en français."; }
      catch (e) { $("rg-lang-note").textContent = e.message; sel.value = window.enosLang; }
    };
  }

  // ---- aperçu « grand public » (téléphone de confiance) : bouton côté Dev, menu caché (5 appuis sur le logo) pour revenir
  async function setPreview(on) {
    try { await post("/api/edition/preview", { on }); location.reload(); }
    catch (e) {                                                       // l'échec s'affiche (avant : silence total)
      const sm = $("b-preview") && $("b-preview").querySelector("small");
      if (sm) sm.textContent = "Impossible : " + (e.message === "Not Found" ? "cet appareil n'est pas approuvé en Eto Dev (RÉGLAGES → APPAREILS sur le PC)." : e.message);
    }
  }
  function initPreview() {
    $("b-preview").hidden = !(E.trusted && isDev());
    if (!window.__previewBound) {                                     // délégation : survit à tout remplacement du bouton
      window.__previewBound = true;
      document.addEventListener("click", (ev) => { if (ev.target.closest("#b-preview")) setPreview(true); });
    }
    if (E.preview) {
      const bar = document.createElement("div");
      bar.textContent = "APERÇU GRAND PUBLIC · 5 appuis sur le logo pour revenir en Dev";
      bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:500;padding:4px 8px calc(4px + env(safe-area-inset-bottom,0px));font:11px Consolas,monospace;letter-spacing:1px;text-align:center;background:var(--mg);color:#000;opacity:.85;pointer-events:none";
      document.body.appendChild(bar);
    }
    let taps = [];
    const logo = $("logo");
    if (logo) logo.addEventListener("click", () => {
      const now = Date.now(); taps = taps.filter((x) => now - x < 3000); taps.push(now);
      if (taps.length >= 5 && E.trusted) { taps = []; setPreview(!E.preview); }
    });
  }

  // ============================================================== RÉGLAGES
  const HUES = { menace: [356, 1], neon: [135, 1], violet: [272, 1], rouge: [2, 1], ambre: [38, 1], glace: [196, .95], synthwave: [316, 1], luxe: [44, .9], pro: [214, .28], entreprise: [212, .7], chill: [282, .62] };
  function drawThemes() {
    const T = window.enosTheme; if (!T) return;
    $("rg-themes").innerHTML = T.list.map((t) => {
      const [h, s] = HUES[t.id] || [135, 1];
      return `<button class="th-card ${T.current() === t.id ? "on" : ""}" data-theme="${t.id}" style="--h:${h};--sat:${s}" type="button"><span class="mock"><b></b><i></i><em></em></span><strong>${esc(t.name)}</strong><small>${esc(t.sub)}</small></button>`;
    }).join("");
    $("rg-accent").innerHTML = T.accents.map((a) => `<button type="button" class="ac-sw ${T.accent() === a.id ? "on" : ""}" data-ac="${a.id}" style="--sw:${a.color}" aria-pressed="${T.accent() === a.id}"><i></i>${a.name}</button>`).join("");
    $("rg-shiny").checked = T.shiny();
    const h = T.hue(), s = T.sat();
    const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--h")) || 135;
    $("rg-hue").value = h === null ? Math.round(cur) : h; $("rg-hue-v").textContent = $("rg-hue").value + "°";
    const cs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sat"));
    $("rg-sat").value = Math.round((s === null ? (isNaN(cs) ? 1 : cs) : +s) * 100); $("rg-sat-v").textContent = $("rg-sat").value + "%";
  }
  function initThemes() {
    $("rg-themes").addEventListener("click", (e) => { const c = e.target.closest(".th-card"); if (c) { window.enosTheme.setTheme(c.dataset.theme); drawThemes(); } });
    $("rg-accent").addEventListener("click", (e) => { const b = e.target.closest("[data-ac]"); if (b) { window.enosTheme.setAccent(b.dataset.ac); drawThemes(); } });
    $("rg-shiny").onchange = (e) => window.enosTheme.setShiny(e.target.checked);
    $("rg-hue").oninput = (e) => { window.enosTheme.setHue(+e.target.value); $("rg-hue-v").textContent = e.target.value + "°"; };
    $("rg-sat").oninput = (e) => { window.enosTheme.setSat(+e.target.value / 100); $("rg-sat-v").textContent = e.target.value + "%"; };
    $("rg-reset").onclick = () => { window.enosTheme.reset(); drawThemes(); };
  }

  let prof = null;
  async function loadProfile() {
    try { prof = await api("/api/settings/profile"); } catch (e) { $("rg-perr").textContent = e.message; return; }
    $("rg-prof").innerHTML = prof.profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === prof.active ? "selected" : ""}>${esc(p.label)}</option>`).join("");
    $("rg-label").value = prof.label;
    $("rg-pfinfo").textContent = `Fichier : ${prof.file} · reconnu comme « ${prof.label} » via le compte Windows${prof.windows_users.length ? " (" + prof.windows_users.join(", ") + ")" : ""}.`;
    $("rg-paths").innerHTML = prof.paths.map((p) => `<div class="tm-item" data-k="${p.key}"><div class="grow"><b>${esc(p.label)}</b><br><input type="text" value="${esc(p.value)}" placeholder="${p.kind === "dir" ? "Dossier" : "Programme (.exe)"} — non défini" spellcheck="false" style="width:100%"></div><button class="btn sm" data-a="pick">PARCOURIR…</button><button class="btn sm" data-a="save">ENREGISTRER</button></div>`).join("");
  }
  async function saveProfile(body) {
    $("rg-perr").textContent = "";
    try { prof = await post("/api/settings/profile", body); await loadProfile(); $("rg-perr").innerHTML = '<span class="tm-ok">✔ enregistré</span>'; refreshUser(); }
    catch (e) { $("rg-perr").textContent = e.message; }
  }
  async function refreshUser() {
    try { const st = await api("/api/status"); window.enosUser = st.user ? st.user.label : ""; E.user = st.user || E.user; applyUser(); } catch (e) {}
  }
  function initProfile() {
    $("rg-prof").onchange = (e) => saveProfile({ active: e.target.value });
    $("rg-label-save").onclick = () => saveProfile({ label: $("rg-label").value });
    $("rg-paths").addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-a]"); if (!b) return;
      const row = b.closest(".tm-item"), inp = row.querySelector("input");
      if (b.dataset.a === "pick") {
        try { const r = await post("/api/settings/pick", { key: row.dataset.k }); if (r.error) $("rg-perr").textContent = r.error; else if (r.path) inp.value = r.path; } catch (er) { $("rg-perr").textContent = er.message; }
      } else saveProfile({ paths: { [row.dataset.k]: inp.value.trim() } });
    });
  }

  async function loadDevices() {
    let d; try { d = await api("/api/team/devices"); } catch (e) { return; }
    $("rg-pending").innerHTML = d.pending.length ? d.pending.map((p) => `<div class="tm-item" data-u="${esc(p.uuid)}"><div class="grow"><span class="tm-uuid">${esc(p.uuid)}</span><br><small>${esc(p.ip)} · vu il y a ${ago(p.last)} · ${esc(p.ua)}</small></div><input type="text" placeholder="Nom" maxlength="40" style="max-width:160px"><button class="btn sm" data-a="ok">APPROUVER</button><button class="btn sm" data-a="no">REFUSER</button></div>`).join("") : '<div class="tm-empty">Aucun appareil en attente.</div>';
    try {                                                              // appareils réellement connectés (jeton/code), pas seulement les UUID approuvés
      const c = await api("/api/devices");
      const iso = (t) => { const s = (Date.now() - new Date(t).getTime()) / 1000; return s < 90 ? "à l'instant" : s < 3600 ? Math.round(s / 60) + " min" : s < 86400 ? Math.round(s / 3600) + " h" : Math.round(s / 86400) + " j"; };
      $("rg-conn").innerHTML = c.devices.length ? c.devices.map((p) => `<div class="tm-item" data-id="${esc(p.id)}"><div class="grow"><b>${esc(p.name)}</b>${p.ip_trusted ? ' <span class="tm-tag me">IP DE CONFIANCE</span>' : ""}<br><small>${esc(p.ip)} · vu il y a ${iso(p.last_seen)}</small></div><button class="btn sm" data-a="rev">RÉVOQUER</button></div>`).join("")
        : '<div class="tm-empty">Aucun téléphone connecté. (Activez [ ACCÈS TÉLÉPHONE ] dans le menu, puis entrez le code sur le téléphone.)</div>';
    } catch (e) { $("rg-conn").innerHTML = `<div class="tm-empty">Liste indisponible : ${esc(e.message)}</div>`; }
    $("rg-devs").innerHTML = d.devices.length ? d.devices.map((p) => `<div class="tm-item" data-u="${esc(p.uuid)}"><div class="grow"><b>${esc(p.name)}</b><br><small class="tm-uuid">${esc(p.uuid)}</small><br><small>${p.last_seen ? "vu il y a " + ago(p.last_seen) + " · " + esc(p.ip) : "jamais connecté"}</small></div><button class="btn sm" data-a="full" title="Le téléphone agit sur ce PC comme ce PC lui-même (programmes, fichiers). Ne l'active que sur TON téléphone.">${p.full ? "DROITS COMPLETS : OUI" : "DROITS COMPLETS : NON"}</button> <button class="btn sm" data-a="no">RÉVOQUER</button></div>`).join("") : '<div class="tm-empty">Aucun appareil approuvé.</div>';
    const n = d.pending.length;
    [$("rg-badge"), $("rg-pend")].forEach((x) => { x.textContent = n || ""; x.hidden = !n; });
  }
  function initDevices() {
    const act = async (fn) => { $("rg-derr").textContent = ""; try { await fn(); } catch (e) { $("rg-derr").textContent = e.message; } loadDevices(); };
    $("rg-pending").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-a]"); if (!b) return; const row = b.closest(".tm-item"), u = row.dataset.u;
      act(() => (b.dataset.a === "ok" ? post("/api/team/devices", { uuid: u, name: row.querySelector("input").value || "Appareil" }) : api("/api/team/devices/" + encodeURIComponent(u), { method: "DELETE" })));
    });
    $("rg-conn").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-a=rev]"); if (!b) return;
      act(() => api("/api/devices/" + encodeURIComponent(b.closest(".tm-item").dataset.id), { method: "DELETE" }));
    });
    $("rg-devs").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-a]"); if (!b) return;
      if (b.dataset.a === "full") { const row = b.closest(".tm-item"), on = !/OUI/.test(b.textContent); act(() => post("/api/team/devices/" + encodeURIComponent(row.dataset.u) + "/full", { on })); return; }
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "CONFIRMER ?"; setTimeout(() => { b.classList.remove("armed"); b.textContent = "RÉVOQUER"; }, 4000); return; }
      act(() => api("/api/team/devices/" + encodeURIComponent(b.closest(".tm-item").dataset.u), { method: "DELETE" }));
    });
    $("rg-d-add").onclick = () => act(async () => { await post("/api/team/devices", { uuid: $("rg-d-uuid").value, name: $("rg-d-name").value }); $("rg-d-uuid").value = $("rg-d-name").value = ""; });
  }
  function drawDevice() {
    $("rg-brand").textContent = E.brand;
    $("rg-edtxt").textContent = E.local ? "Ce PC : accès complet (administrateur)." : isDev() ? "Appareil de confiance : outils premium, chat et entrepôt débloqués." : "Version gratuite : fonctions de base. Les outils premium sont réservés aux appareils de confiance.";
    $("rg-myuuid").textContent = E.local ? "— (ce PC n'a pas besoin d'UUID)" : (window.naskoSec && window.naskoSec.deviceId()) || "—";
  }
  function openSettings() {
    open("rg"); drawThemes(); drawDevice();
    if (E.local) { loadProfile(); loadDevices(); }
  }

  // ============================================================== HUB : entrepôt
  let wh = { items: [], peers: [], me: "" };
  async function loadWarehouse() {
    $("hb-wh-err").textContent = "";
    try {
      wh = await api("/api/warehouse");
      const [pc, dest] = await Promise.all([api("/api/colis").catch(() => ({ items: [] })), api("/api/imgproc/destinations").catch(() => ({ items: [] }))]);
      $("hb-wh-colis").innerHTML = pc.items.length ? pc.items.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("") : '<option value="">(aucun colis en attente)</option>';
      $("hb-wh-dest").innerHTML = dest.items.filter((d) => d.ok).map((d) => `<option value="${esc(d.path)}">${esc(d.label)}</option>`).join("") || '<option value="">(aucune destination)</option>';
    } catch (e) { $("hb-wh-err").textContent = e.message; $("hb-wh-list").innerHTML = ""; return; }
    $("hb-wh-root").textContent = "dossier partagé : " + wh.root_name;
    $("hb-wh-peers").textContent = wh.peers.length ? "associés : " + wh.peers.map((p) => p.label + (Date.now() / 1000 - p.last_online < 600 ? " ●" : "")).join(", ") : "aucun associé détecté dans l'entrepôt";
    const L = $("hb-wh-list");
    L.innerHTML = wh.items.length ? wh.items.map((it, i) => {
      const who = it.mine ? "moi" : (wh.peers.find((p) => p.id === it.owner) || { label: it.owner }).label;
      const bad = it.kind === "colis" && it.count === null;
      return `<div class="tm-item ${it.new ? "new" : ""}" data-i="${i}"><div class="grow"><b>${esc(it.name)}</b>${it.new ? ' <span class="tm-tag new">NOUVEAU</span>' : ""} <span class="tm-tag ${it.mine ? "me" : ""}">${esc(who.toUpperCase())}</span><br><small>${it.kind === "colis" ? "colis" : "fichier"} · ${size(it.size)}${it.count != null ? " · " + it.count + " fichier(s)" : ""}${bad ? " · synchronisation en cours…" : ""} · il y a ${ago(it.t)}</small><div class="wh-contents" hidden></div></div>
        ${it.kind === "colis" && !bad ? '<button class="btn sm" data-a="view">CONTENU</button><button class="btn sm" data-a="deliver">LIVRER</button>' : ""}
        ${it.mine ? "" : '<button class="btn sm" data-a="fetch">RÉCUPÉRER</button>'}<button class="btn sm" data-a="archive">ARCHIVER</button>${it.mine ? '<button class="btn sm" data-a="remove">RETIRER</button>' : ""}</div>`;
    }).join("") : '<div class="tm-empty">L\'entrepôt est vide. Envoyez un colis ci-dessus, ou attendez celui de votre associé.</div>';
    updateBadges();
  }
  function initWarehouse() {
    $("hb-wh-refresh").onclick = loadWarehouse;
    $("hb-wh-send").onclick = async () => {
      const n = $("hb-wh-colis").value; if (!n) return;
      try { await post("/api/warehouse/publish", { kind: "colis", name: n }); loadWarehouse(); } catch (e) { $("hb-wh-err").textContent = e.message; }
    };
    $("hb-wh-pick").onclick = async () => { try { const r = await post("/api/sync/pick"); if (r.path) $("hb-wh-path").value = r.path; else if (r.error) $("hb-wh-err").textContent = r.error; } catch (e) { $("hb-wh-err").textContent = e.message; } };
    $("hb-wh-sendf").onclick = async () => {
      const p = $("hb-wh-path").value.trim(); if (!p) return;
      try { await post("/api/warehouse/publish", { kind: "fichiers", path: p }); $("hb-wh-path").value = ""; loadWarehouse(); } catch (e) { $("hb-wh-err").textContent = e.message; }
    };
    $("hb-wh-list").addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-a]"); if (!b) return;
      const row = b.closest(".tm-item"), it = wh.items[+row.dataset.i], ref = { owner: it.owner, kind: it.kind, name: it.name };
      $("hb-wh-err").textContent = ""; b.disabled = true;
      try {
        if (b.dataset.a === "view") {
          const c = await post("/api/warehouse/contents", ref), box = row.querySelector(".wh-contents");
          box.innerHTML = `<small>${c.files.map((f) => esc(f.name) + " (" + size(f.size) + ")").join(" · ")}${c.count > c.files.length ? " …" : ""}</small>`; box.hidden = !box.hidden;
        } else if (b.dataset.a === "fetch") {
          const r = await post("/api/warehouse/fetch", ref); b.textContent = "RÉCUPÉRÉ ✔"; $("hb-wh-err").innerHTML = `<span class="tm-ok">« ${esc(r.name)} » copié ${it.kind === "colis" ? "dans GÉRER LES COLIS" : "dans Stockage/Entrepôt"}.</span>`;
        } else if (b.dataset.a === "deliver") {
          const d = $("hb-wh-dest").value; if (!d) throw new Error("Choisissez une destination de livraison.");
          const r = await post("/api/warehouse/deliver", { owner: it.owner, name: it.name, dest: d }); $("hb-wh-err").innerHTML = `<span class="tm-ok">✔ ${r.count} fichier(s) livrés dans « ${esc(r.folder.split(/[\\/]/).pop())} ».</span>`;
        } else if (b.dataset.a === "archive") { await post("/api/warehouse/archive", ref); loadWarehouse(); return; }
        else if (b.dataset.a === "remove") {
          if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "CONFIRMER ?"; b.disabled = false; setTimeout(() => { b.classList.remove("armed"); b.textContent = "RETIRER"; }, 4000); return; }
          await post("/api/warehouse/remove", ref); loadWarehouse(); return;
        }
      } catch (er) { $("hb-wh-err").textContent = er.message; }
      b.disabled = false;
    });
  }

  // ============================================================== HUB : chat
  let ws = null, wsOk = false, poll = 0, lastT = 0, chatOpen = false, unread = 0, seenIds = new Set(), me = "";
  function addMsg(m, quiet) {
    if (seenIds.has(m.id)) return; seenIds.add(m.id); lastT = Math.max(lastT, m.t);
    if (typeof m.text === "string" && m.text.startsWith("[MAJ_GODOT_DISPONIBLE]")) return;           // signal système : jamais affiché comme message
    const mine = m.from === me, d = document.createElement("div");
    d.className = "cm" + (mine ? " me" : ""); d.innerHTML = `<small>${esc(m.label)} · ${new Date(m.t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</small>${esc(m.text)}`;
    const log = $("hb-log"), bottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
    log.appendChild(d); if (bottom || mine) log.scrollTop = log.scrollHeight;
    if (!quiet && !mine && !(chatOpen && !$("hb").hidden)) { unread++; updateBadges(); }
  }
  async function chatHistory(first) {
    try { const h = await api("/api/devchat/history?after=" + (first ? 0 : lastT)); me = h.me; h.items.forEach((m) => addMsg(m, first)); peerState(h.peer); } catch (e) {}
  }
  function peerState(p) { $("hb-ch-st").textContent = (wsOk ? "● en direct" : "○ actualisation périodique") + (p && p.state === "on" ? " · associé connecté" : ""); }
  async function connectWs() {
    if (ws || !window.WebSocket || !window.naskoSec) return;
    try {
      const u = await window.naskoSec.wsUrl("/ws/chat");
      ws = new WebSocket(u);
      ws.onopen = () => { wsOk = true; peerState(); };
      ws.onmessage = (e) => { try { const f = JSON.parse(e.data); if (f.type === "msg") addMsg(f.msg); else if (f.type === "presence") peerState({ state: f.peer }); } catch (x) {} };
      ws.onclose = () => { wsOk = false; ws = null; peerState(); };
      ws.onerror = () => { try { ws.close(); } catch (x) {} };
    } catch (e) { ws = null; }
  }
  function startChat() {
    chatOpen = true; unread = 0; updateBadges();
    chatHistory(!seenIds.size); connectWs();
    clearInterval(poll); poll = setInterval(() => { if (!wsOk) chatHistory(false); else if (!ws || ws.readyState > 1) ws = null; if (!ws) connectWs(); }, 3500);
    if (E.local) loadChannel();
  }
  // ---- canal : un bouton
  let chanTimer = 0;
  async function loadChannel() {
    let c; try { c = await api("/api/channel"); } catch (e) { return; }
    const st = $("hb-chan-st"); st.className = "chan-st " + (c.level || ""); st.textContent = c.headline || "";
    $("hb-chan").textContent = c.open ? "RECONNECTER LE CANAL" : "OUVRIR LE CANAL"; $("hb-chan-off").hidden = !c.open;
    $("hb-chan-note").textContent = c.open && c.direct && c.direct.state === "connecting" && c.direct.detail && c.level !== "good" ? "Liaison directe en cours (" + c.direct.detail + ")…" : "";
    clearTimeout(chanTimer); if (chatOpen && !$("hb").hidden) chanTimer = setTimeout(loadChannel, 3500);
  }
  function initChat() {
    $("hb-ch-form").onsubmit = async (e) => {
      e.preventDefault(); const t = $("hb-ch-inp").value.trim(); if (!t) return; $("hb-ch-inp").value = "";
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "msg", msg: { text: t } }));
      else { try { await post("/api/devchat/send", { text: t }); chatHistory(false); } catch (er) { addMsg({ id: "e" + Date.now(), t: Date.now() / 1000, from: "?", label: "ERREUR", text: er.message }, true); } }
    };
    $("hb-chan").onclick = async () => {
      $("hb-chan-err").textContent = ""; $("hb-chan").disabled = true;
      try { const r = await post("/api/channel/open"); if (r.direct_error) $("hb-chan-note").textContent = "Liaison directe indisponible (" + r.direct_error + ") : le dossier partagé assure le relais."; } catch (e) { $("hb-chan-err").textContent = e.message; }
      $("hb-chan").disabled = false; loadChannel();
    };
    $("hb-chan-off").onclick = async () => { try { await post("/api/channel/close"); } catch (e) {} loadChannel(); };
  }

  // ============================================================== HUB : git
  let gitTimer = 0;
  const STAT = { wait: "en attente", run: "en cours…", ok: "terminé", skip: "ignoré", err: "ÉCHEC" };
  function drawGit(r) {
    const i = r.info || {};
    $("gt-info").textContent = !i.git ? "Git introuvable" : !i.repo ? "dossier non relié à Git" : `branche ${i.branch} · ${i.changes} modification(s)${i.remote ? "" : " · dépôt distant non relié"}`;
    const run = r.run || {};
    $("gt-steps").innerHTML = (run.steps || []).map((s) => `<div class="gt-step ${s.status}"><i></i><div>${esc(s.label)} — ${STAT[s.status] || ""}${s.detail ? `<small>${esc(s.detail)}</small>` : ""}</div></div>`).join("");
    $("gt-go").disabled = !!run.running; $("gt-go").textContent = run.running ? "SYNCHRONISATION EN COURS…" : "SYNCHRONISER LE PROJET";
    const choice = !run.running && run.needs_choice;
    $("gt-msg").innerHTML = run.running || run.ok === null ? "" : run.ok ? `<div class="gt-msg ok">✔ ${esc(run.message)}</div>` : `<div class="gt-msg bad">${choice ? "⚠" : "✕"} ${esc(run.message)}</div>`;
    $("gt-choice").hidden = !choice; if (choice) $("gt-files").textContent = (run.conflicts || []).join("\n");
    $("gt-setup").hidden = !(i.git && (!i.repo || !i.remote));
    return !!run.running;
  }
  async function gitStatus() {
    try { const r = await api("/api/git/status"); if (drawGit(r)) { clearTimeout(gitTimer); gitTimer = setTimeout(gitStatus, 700); } } catch (e) { $("gt-msg").innerHTML = `<div class="gt-msg bad">${esc(e.message)}</div>`; }
  }
  async function gitSync(resolve) {
    try { await post("/api/git/sync", { resolve: resolve || "" }); } catch (e) { $("gt-msg").innerHTML = `<div class="gt-msg bad">✕ ${esc(e.message)}</div>`; return; }
    $("gt-choice").hidden = true; gitStatus();
  }

  // ============================================================== badges + ouverture du hub
  async function updateBadges() {
    let n = 0;
    if (isDev()) { try { n = (await api("/api/warehouse/badge")).new || 0; } catch (e) {} }
    const set = (el, v) => { el.textContent = v || ""; el.hidden = !v; };
    set($("hb-wh-n"), n); set($("hb-ch-n"), unread); set($("hb-badge"), n + unread);
  }
  function openHub(tab) {
    open("hb"); showTab($("hb-tabs"), tab || "wh");
  }
  function hubTab(t) {
    chatOpen = t === "ch";
    if (t === "wh") { loadWarehouse().then(() => api("/api/warehouse/seen", { method: "POST" }).then(updateBadges).catch(() => {})); }
    if (t === "ch") startChat();
    if (t === "gt") gitStatus();
  }
  function closeHub() { $("hb").hidden = true; chatOpen = false; }

  // ============================================================== SITE WEB (serveur local Dual Pulse)
  function initSite() {
    let timer = null;
    const T = {
      on: ["on", "En ligne", "Le serveur répond : le site est prêt à être consulté."],
      off: ["off", "Hors ligne", "Le serveur ne répond pas. Cliquez sur « Démarrer le serveur » : le site sera prêt dans quelques secondes."],
      wait: ["wait", "Démarrage…", "Le serveur démarre en arrière-plan (la première fois, l'installation des dépendances peut prendre une minute)."],
      nobat: ["off", "Introuvable", "Le dossier dualpulse_site (lancer_site.bat) est introuvable à côté de ENOS.exe."],
    };
    const paint = (k) => {
      const [s, l, t] = T[k];
      $("sw-state").dataset.s = s; $("sw-label").textContent = l; $("sw-text").textContent = t;
      $("sw-start").disabled = k !== "off"; $("sw-open").disabled = k !== "on";
      $("sw-tun").disabled = k !== "on";
    };
    let asked = false;
    const paintTun = (t) => {
      const on = t && t.active;
      $("sw-tun").hidden = !!on; $("sw-tun-off").hidden = !on;
      $("sw-link").hidden = !(on && t.url);
      if (on && t.url) { if ($("sw-url").value !== t.url) $("sw-url").value = t.url; $("sw-tmsg").innerHTML = ""; asked = false; }
      else if (on) $("sw-tmsg").innerHTML = `<div class="tm-note">Création du lien… (quelques secondes)</div>`;
      else if (t && t.error && asked) $("sw-tmsg").innerHTML = `<div class="gt-msg bad">✕ ${esc(t.error)}</div>`;
    };
    const refresh = async () => {
      try { const st = await api("/api/site/status"); paint(!st.installed ? "nobat" : st.online ? "on" : st.starting ? "wait" : "off"); paintTun(st.tunnel); }
      catch (e) { paint("off"); }
    };
    const stop = () => { clearInterval(timer); timer = null; };
    $("b-site").onclick = () => { $("sw-msg").innerHTML = ""; open("sw"); refresh(); stop(); timer = setInterval(refresh, 2500); };
    $("sw-close").onclick = () => { $("sw").hidden = true; stop(); };
    $("sw-start").onclick = async () => {
      $("sw-msg").innerHTML = ""; paint("wait");
      try { await post("/api/site/start"); } catch (e) { $("sw-msg").innerHTML = `<div class="gt-msg bad">✕ ${esc(e.message)}</div>`; }
      refresh();
    };
    $("sw-open").onclick = async () => { try { await post("/api/site/open"); } catch (e) { $("sw-msg").innerHTML = `<div class="gt-msg bad">✕ ${esc(e.message)}</div>`; refresh(); } };
    $("sw-tun").onclick = async () => { asked = true; $("sw-tmsg").innerHTML = ""; try { await post("/api/site/tunnel"); } catch (e) { $("sw-tmsg").innerHTML = `<div class="gt-msg bad">✕ ${esc(e.message)}</div>`; } refresh(); };
    $("sw-tun-off").onclick = async () => { try { await api("/api/site/tunnel", { method: "DELETE" }); } catch (e) {} $("sw-link").hidden = true; $("sw-url").value = ""; refresh(); };
    $("sw-copy").onclick = async () => {
      const u = $("sw-url"); u.select();
      try { await navigator.clipboard.writeText(u.value); } catch (e) { try { document.execCommand("copy"); } catch (_) {} }
      $("sw-copy").textContent = "COPIÉ ✓"; setTimeout(() => ($("sw-copy").textContent = "COPIER"), 1500);
    };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sw").hidden) $("sw-close").click(); });
  }

  // ============================================================== CONSTRUIRE UN COLIS (zip d'un dossier + envoi vers le projet / l'entrepôt)
  function initPack() {
    let timer = null, lastMsg = "";
    const note = (id, html) => ($(id).innerHTML = html);
    const bad = (id, m) => note(id, `<div class="gt-msg bad">✕ ${esc(m)}</div>`);
    const good = (id, m) => note(id, `<div class="gt-msg ok">✓ ${esc(m)}</div>`);
    const draw = (st) => {
      const j = st.job || {};
      $("pk-go").disabled = !!j.running;
      if (j.running) note("pk-msg", `<div class="gt-msg pk-busy">Compression de « ${esc(j.src)} »… patientez (les gros exports prennent un moment).</div>`);
      else if (j.message && j.message !== lastMsg) { lastMsg = j.message; (j.ok ? good : bad)("pk-msg", j.message); }
      $("pk-folder").textContent = st.folder || "";
      const sel = $("pk-dest"), cur = sel.value;
      sel.innerHTML = st.dests.map((d) => `<option value="${d.key}"${d.ok ? "" : " disabled"}>${esc(d.label)} — ${d.path ? esc(d.path) : "non défini (RÉGLAGES → PROFIL)"}</option>`).join("");
      sel.value = st.dests.some((d) => d.key === cur && d.ok) ? cur : ((st.dests.find((d) => d.ok) || {}).key || "");
      const can = st.dests.some((d) => d.key === sel.value && d.ok);
      $("pk-list").innerHTML = st.items.length
        ? st.items.map((it) => `<div class="pk-item" data-n="${esc(it.name)}"><div class="grow"><b>${esc(it.name)}</b><small>${size(it.size)} · il y a ${ago(it.t)}</small></div><button class="btn" data-a="send"${can ? "" : " disabled"}>ENVOYER SUR LE DOSSIER DU PROJET</button><button class="btn sm" data-a="del">SUPPRIMER</button></div>`).join("")
        : `<div class="tm-note">Aucun colis construit pour l'instant.</div>`;
    };
    const refresh = async () => { try { draw(await api("/api/pack/status")); } catch (e) { bad("pk-msg", e.message); } };
    const stop = () => { clearInterval(timer); timer = null; };
    $("b-pk").onclick = () => { note("pk-msg", ""); lastMsg = ""; open("pk"); refresh(); stop(); timer = setInterval(refresh, 1500); };
    $("pk-close").onclick = () => { $("pk").hidden = true; stop(); };
    $("pk-pick").onclick = async () => { try { const r = await post("/api/pack/pick"); if (r.path) $("pk-src").value = r.path; else if (r.error) bad("pk-msg", r.error); } catch (e) { bad("pk-msg", e.message); } };
    $("pk-go").onclick = async () => {
      const v = $("pk-src").value.trim();
      if (!v) return bad("pk-msg", "Choisissez d'abord un dossier.");
      try { lastMsg = ""; await post("/api/pack/build", { src: v }); } catch (e) { return bad("pk-msg", e.message); }
      refresh();
    };
    $("pk-list").onclick = async (e) => {
      const b = e.target.closest("button[data-a]"); if (!b) return;
      const name = b.closest(".pk-item").dataset.n;
      if (b.dataset.a === "send") {
        b.disabled = true;
        try { const r = await post("/api/pack/send", { name, dest: $("pk-dest").value }); good("pk-msg", "Copié vers " + r.path); } catch (er) { bad("pk-msg", er.message); }
        refresh();
      } else if (b.dataset.a === "del") {
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "CONFIRMER ?"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "SUPPRIMER"; }, 3000); return; }
        try { await api("/api/pack/item?name=" + encodeURIComponent(name), { method: "DELETE" }); } catch (er) { bad("pk-msg", er.message); }
        refresh();
      }
    };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("pk").hidden) $("pk-close").click(); });
  }

  // ============================================================== SYNC GODOT INVISIBLE (Git + signal dans le chat partagé)
  function initGodotSync() {
    let timer = null, later = "", cur = "", phase = "idle";
    const msg = (id, cls, m) => ($(id).innerHTML = m ? `<div class="gt-msg ${cls}">${cls === "bad" ? "✕" : cls === "ok" ? "✓" : ""} ${esc(m)}</div>` : "");
    const STATE_TXT = {
      unset: "Aucun dossier Godot défini pour ce profil.", missing: "Le dossier n'existe pas encore : il sera créé et rempli (clone) à la première mise à jour reçue.",
      empty: "Dossier vide : la première mise à jour reçue sera téléchargée en entier (clone).", repo: "Dépôt Git détecté : prêt à envoyer et à recevoir.",
      other: "Ce dossier contient des fichiers mais n'est pas un dépôt Git : utilisez « CONNECTER LE DÉPÔT » (Hub → Projet Git) avant de diffuser.",
    };
    const draw = (st) => {
      if (!$("gs").hidden) {
        if (document.activeElement !== $("gs-dir")) $("gs-dir").value = st.dir || "";
        $("gs-state").textContent = STATE_TXT[st.dir_state] || "";
        const g = st.git || {};
        $("gs-go").disabled = !!g.running || st.dir_state === "unset" || st.dir_state === "other";
        $("gs-steps").innerHTML = (g.steps || []).map((s) => `<div class="gt-step ${s.status}"><i></i><div>${esc(s.label)}${s.detail ? `<small>${esc(s.detail.slice(0, 200))}</small>` : ""}</div></div>`).join("");
        $("gs-choice").hidden = !g.needs_choice;
        if (g.running) msg("gs-msg", "", "");
        else if (g.message) msg("gs-msg", g.ok ? "ok" : "bad", g.message + (g.needs_choice ? " " + (g.conflicts || []).slice(0, 6).join(", ") : "") + (g.ok && st.relay !== "on" ? " — mais l'associé ne sera PAS alerté : l'entrepôt partagé n'est pas configuré (RÉGLAGES → PROFIL)." : g.ok ? " Votre associé est prévenu." : ""));
        $("gs-recv").textContent = st.recv.message || "";
        $("gs-recv").className = "tm-note" + (st.recv.ok === false ? " tm-err" : "");
        $("gs-pull").disabled = !!st.recv.running;
      }
      const p = st.pending, a = $("gs-alert");
      if (phase === "busy") {
        if (st.recv.running) return;
        phase = "done"; a.classList.toggle("bad", st.recv.ok === false);
        $("gs-alert-t").textContent = st.recv.message || "Terminé.";
        setTimeout(() => { a.hidden = true; a.classList.remove("bad"); phase = "idle"; }, st.recv.ok === false ? 12000 : 4500);
        return;
      }
      if (phase === "ask" && !p) { a.hidden = true; phase = "idle"; }
      else if (phase === "idle" && p && p.id !== later) {
        phase = "ask"; cur = p.id; a.hidden = false; a.classList.remove("bad"); $("gs-alert-b").hidden = false;
        $("gs-alert-t").textContent = `${p.label} a mis à jour le jeu ! Voulez-vous synchroniser votre projet maintenant ?`;
      }
    };
    const tick = async () => {
      if (!E.local) return;
      try { draw(await api("/api/godotsync/status")); } catch (e) {}
    };
    const fast = () => { clearInterval(timer); timer = setInterval(tick, 1500); setTimeout(() => { clearInterval(timer); timer = setInterval(tick, 5000); }, 90000); };
    timer = setInterval(tick, 5000); setTimeout(tick, 2500);                  // écoute permanente : alerte même fenêtre fermée
    $("b-gs").onclick = () => { open("gs"); tick(); fast(); };
    $("gs-close").onclick = () => ($("gs").hidden = true);
    $("gs-pick").onclick = async () => { try { const r = await post("/api/settings/pick", { key: "project_dir" }); if (r.path) $("gs-dir").value = r.path; else if (r.error) msg("gs-msg", "bad", r.error); } catch (e) { msg("gs-msg", "bad", e.message); } };
    $("gs-save").onclick = async () => { try { await post("/api/settings/profile", { paths: { project_dir: $("gs-dir").value.trim() } }); msg("gs-msg", "ok", "Dossier Godot enregistré dans votre profil."); } catch (e) { msg("gs-msg", "bad", e.message); } tick(); };
    const broadcast = async (resolve) => { msg("gs-msg", "", ""); try { await post("/api/godotsync/broadcast", { resolve: resolve || "" }); } catch (e) { return msg("gs-msg", "bad", e.message); } fast(); tick(); };
    $("gs-go").onclick = () => broadcast();
    $("gs-ours").onclick = () => broadcast("ours"); $("gs-theirs").onclick = () => broadcast("theirs");
    $("gs-pull").onclick = async () => { try { await post("/api/godotsync/accept"); } catch (e) { return msg("gs-msg", "bad", e.message); } fast(); tick(); };
    $("gs-ok").onclick = async () => {
      phase = "busy"; $("gs-alert-b").hidden = true; $("gs-alert-t").textContent = "Téléchargement de la mise à jour…";
      try { await post("/api/godotsync/accept"); } catch (e) { phase = "done"; $("gs-alert-t").textContent = e.message; $("gs-alert").classList.add("bad"); setTimeout(() => { $("gs-alert").hidden = true; $("gs-alert").classList.remove("bad"); phase = "idle"; }, 8000); return; }
      fast(); tick();
    };
    $("gs-later").onclick = () => { later = cur; phase = "idle"; $("gs-alert").hidden = true; };
    $("gs-ignore").onclick = async () => { try { await post("/api/godotsync/dismiss"); } catch (e) {} later = cur; phase = "idle"; $("gs-alert").hidden = true; };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("gs").hidden) $("gs-close").click(); });
  }

  // ============================================================== démarrage
  async function init() {
    initThemes(); initProfile(); initDevices(); initWarehouse(); initChat();
    tabs($("rg-tabs"), $("rg"), (t) => { if (t === "ed") drawDevice(); });
    tabs($("hb-tabs"), $("hb"), hubTab);
    $("b-rg").onclick = openSettings; $("rg-close").onclick = () => ($("rg").hidden = true);
    $("b-hb").onclick = () => openHub("wh"); $("hb-close").onclick = closeHub;
    $("b-gitsync").onclick = () => { openHub("gt"); gitSync(); };
    $("b-assist").onclick = async () => { try { await post("/api/assistant/call"); } catch (e) { alert("Assistant : " + e.message); } };
    initSite(); initPack(); initGodotSync();
    $("gt-go").onclick = () => gitSync();
    $("gt-ours").onclick = () => gitSync("ours"); $("gt-theirs").onclick = () => gitSync("theirs");
    $("gt-setup-go").onclick = async () => { try { await post("/api/git/setup", { url: $("gt-url").value }); $("gt-url").value = ""; gitStatus(); } catch (e) { $("gt-msg").innerHTML = `<div class="gt-msg bad">✕ ${esc(e.message)}</div>`; } };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!$("rg").hidden) $("rg").hidden = true; else if (!$("hb").hidden) closeHub(); } });
    try { await (window.naskoSec ? window.naskoSec.ready() : 0); Object.assign(E, await api("/api/edition")); } catch (e) {}
    applyEdition(); applyUser();
    initPreview(); initLang();
    if (isDev()) { updateBadges(); setInterval(() => { if (!document.hidden) updateBadges(); }, 30000); }
    if (E.local) { loadDevices(); setInterval(() => { if (!document.hidden && $("rg").hidden) loadDevices(); }, 20000); }
  }
  window.enosEdition = E;
  init();
})();
