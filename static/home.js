"use strict";
// ENOS « OS » : dashboard d'accueil, lanceur d'applications, navigation, toasts de l'IA proactive, F11. Actif seulement si html.os (fenêtre native).
(() => {
  const root = document.documentElement;
  if (!root.classList.contains("os")) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const J = async (url, opt) => { const r = await fetch(url, opt); if (!r.ok) throw new Error(r.status); return r.json(); };

  // ------------------------------------------------------------------ icônes (viewBox 24, trait)
  const IC = {
    term: '<path d="M4 17l6-6-6-6M12 19h8"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    play: '<path d="M6 4l14 8-14 8z"/>',
    film: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 12h20"/>',
    eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
    sync: '<path d="M21 12a9 9 0 0 0-15-6.7L3 8M3 3v5h5M3 12a9 9 0 0 0 15 6.7L21 16M21 21v-5h-5"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M1 21a8 8 0 0 1 16 0M17 4a4 4 0 0 1 0 8M23 21a8 8 0 0 0-5-7"/>',
    git: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7M18 11.5c0 4-12 2-12 4"/>',
    cloud: '<path d="M7 18a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 18 10.5 3.75 3.75 0 0 1 17.5 18z"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
    chess: '<path d="M8 21h8M9 21c0-4 1-6 1-9-2-1-3-3-3-5a5 5 0 0 1 10 0c0 2-1 4-3 5 0 3 1 5 1 9"/>',
    shield: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M4.2 19.8L7 17M17 7l2.8-2.8"/>',
    cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4"/>',
    yt: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z"/>',
    gauge: '<path d="M4 18a9 9 0 1 1 16 0M12 18l4-7"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/>',
  };
  const svg = (k, cls) => `<svg viewBox="0 0 24 24"${cls ? ` class="${cls}"` : ""} aria-hidden="true">${IC[k] || IC.grid}</svg>`;
  // id du bouton de la barre latérale -> [icône, catégorie]
  const META = {
    "b-env": ["term", "dev"], "b-px": ["image", "crea"], "b-el": ["music", "ia"], "b-f6-mod": ["play", "dev"], "b-ip": ["image", "crea"], "b-av": ["film", "crea"],
    "b-dm": ["eye", "ia"], "b-sy": ["sync", "sys"], "b-ch": ["music", "ia"], "b-tb": ["globe", "sys"], "b-hb": ["users", "dev"], "b-gitsync": ["git", "dev"],
    "b-assist": ["term", "dev"], "b-site": ["globe", "dev"], "b-pk": ["box", "dev"], "b-mob": ["phone", "sys"], "b-pet": ["eye", "ia"], "b-vac": ["eye", "ia"],
    "b-dev": ["wrench", "dev"], "b-dep": ["git", "dev"], "b-st": ["chess", "ia"], "b-df": ["chess", "ia"], "b-gs": ["git", "dev"], "b-rg": ["gear", "sys"], "b-se": ["shield", "sys"],
    "b-au": ["music", "crea"], "b-yt": ["yt", "crea"], "b-api": ["gauge", "sys"], "b-sys": ["cpu", "sys"], "b-dc": ["trash", "sys"], "b-og": ["folder", "sys"], "b-cp": ["box", "crea"], "b-cine": ["film", "crea"], "b-subs": ["gauge", "sys"], "b-pdf": ["file", "crea"], "b-sm": ["film", "crea"], "b-syl": ["cal", "school"], "b-qt": ["wrench", "sys"],
    "b-colis": ["box", "crea"],
  };
  const CATS = [["all", "TOUT"], ["fav", "FAVORIS"], ["school", "ÉCOLE"], ["dev", "DÉVELOPPEMENT"], ["crea", "CRÉATION"], ["sys", "SYSTÈME"], ["ia", "IA & LOISIRS"]];

  // ------------------------------------------------------------------ vues : accueil / chat
  let view = "home";
  function setView(v) {
    view = v;
    document.body.classList.toggle("view-home", v === "home");
    document.body.classList.toggle("view-chat", v === "chat");
    document.querySelectorAll("#os-nav .os-b[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    if (v === "chat") setTimeout(() => { const i = $("inp"); if (i) i.focus(); }, 60);
    hwTick();
  }
  window.enosOS = { setView, openLauncher: () => openLx(), closeLauncher: () => closeLx(), toast: (t, m, l) => toast({ title: t, message: m, level: l }) };

  // ------------------------------------------------------------------ marquage de la barre latérale (la liste de modules devient le lanceur)
  const sideMods = () => document.querySelector("#side > .sec");
  function trimSide() {
    const side = $("side");
    if (!side) return;
    const h = side.querySelector("h3");
    [h, $("side-none"), side.querySelector(".side-search"), sideMods()].forEach((e) => e && e.classList.add("os-hide"));
    const head = side.querySelector(".drawer-head span");
    if (head) head.textContent = "[ OUTILS DE PROJET ]";
  }

  // ------------------------------------------------------------------ navigation (bandeau du haut)
  function buildNav() {
    const hd = document.querySelector("header");
    if (!hd || $("os-nav")) return;
    const n = document.createElement("nav");
    n.id = "os-nav";
    n.setAttribute("aria-label", "Navigation");
    n.innerHTML = `<button class="os-b on" data-v="home" title="Tableau de bord">${svg("home")}ACCUEIL</button>
      <button class="os-b" data-v="chat" title="Discuter avec E.N.O.S.">${svg("chat")}CHAT IA</button>
      <button class="os-b" id="os-agenda" title="Agenda">${svg("cal")}AGENDA</button>
      <button class="os-b" id="os-apps" title="Toutes les applications (Ctrl+K)">${svg("grid")}APPLICATIONS<kbd>Ctrl K</kbd></button>`;
    hd.appendChild(n);
    n.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => setView(b.dataset.v)));
    $("os-apps").onclick = () => openLx();
    $("os-agenda").onclick = () => openAgenda();
  }
  const openAgenda = () => { if (window.enosAgenda) window.enosAgenda.open(); };

  // ------------------------------------------------------------------ DASHBOARD
  function buildHome() {
    const main = document.querySelector("main");
    if (!main || $("home")) return;
    const s = document.createElement("section");
    s.id = "home";
    s.setAttribute("aria-label", "Accueil");
    s.innerHTML = `<div class="hm-grid">
      <article class="hm-card hm-hero" style="--d:0">
        <div class="hm-hello"><div class="hm-date" id="hm-date"></div><h1 id="hm-hello"></h1><div class="hm-sub" id="hm-sub">Systèmes en ligne. L'IA surveille ton agenda en arrière-plan.</div></div>
        <div class="hm-clock"><span id="hm-clock">--:--</span><small id="hm-week"></small></div>
        <div class="hm-cta">
          <button class="hm-chat" id="hm-chat">${svg("chat")}<span><b>ACCÉDER AU CHAT IA</b><small>Discuter avec E.N.O.S. · voix, vision, actions</small></span></button>
          <button class="hm-apps dev-ok" id="hm-pair">${svg("phone")}<span><b>APPAIRER LE TÉLÉPHONE</b><small>Un QR code · tout est envoyé</small></span></button>
          <button class="hm-apps dev-ok" id="hm-cloud">${svg("cloud")}<span><b>OUVRIR MON CLOUD SÉCURISÉ</b><small>Déposer / récupérer l'APK mobile</small></span></button>
          <button class="hm-apps" id="hm-apps">${svg("grid")}<span><b>APPLICATIONS</b><small>Tous les modules · Ctrl+K</small></span></button>
        </div>
      </article>
      <article class="hm-card hm-hw dev-ok" style="--d:1"><h3>Monitoring matériel<span class="sp" id="hm-hwt">temps réel</span></h3>
        <div class="hm-gauges">${["cpu:CPU", "gpu:GPU", "ram:RAM"].map((x) => { const [k, l] = x.split(":"); return `<div class="hm-g" id="g-${k}"><svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="50" pathLength="100"/><circle class="fg" cx="60" cy="60" r="50" pathLength="100"/></svg><div class="v">--</div><div class="l">${l}</div><div class="s">—</div></div>`; }).join("")}</div>
        <div class="hm-hwfoot" id="hm-hwfoot"></div></article>
      <article class="hm-card hm-day" style="--d:2"><h3>Aperçu de la journée<button id="hm-open-ag">AGENDA ›</button></h3><div id="hm-day"><div class="hm-empty">Chargement…</div></div></article>
      <article class="hm-card hm-ai" style="--d:3"><h3>IA proactive<span class="hm-led" id="hm-led"><i></i><span id="hm-ledt">active</span></span></h3>
        <div class="hm-feed" id="hm-feed"><div class="hm-empty">Aucune alerte pour l'instant. L'IA t'avertira avant chaque rendu, contrôle et cours.</div></div>
        <div class="row"><button class="os-b" id="hm-run">${svg("bell")}ANALYSER MAINTENANT</button><button class="os-b" id="hm-brief">${svg("cal")}BRIEFING DU JOUR</button></div></article>
      <article class="hm-card hm-quick" style="--d:4"><h3>Accès rapide<span class="sp">tes modules les plus utilisés</span></h3><div class="hm-qgrid" id="hm-quick"></div></article>
    </div>`;
    main.prepend(s);
    $("hm-chat").onclick = () => setView("chat");
    $("hm-apps").onclick = () => openLx();
    $("hm-pair").onclick = () => window.enosPair && window.enosPair.open();
    $("hm-cloud").onclick = async (e) => {
      const b = e.currentTarget, sm = b.querySelector("small"), old = sm.textContent;
      b.disabled = true;
      try { await J("/api/cloud/open", { method: "POST" }); sm.textContent = "Ouvert dans ton navigateur ✓"; }
      catch (x) { sm.textContent = "✕ " + (x.message || "impossible"); }
      setTimeout(() => { sm.textContent = old; b.disabled = false; }, 2500);
    };
    $("hm-open-ag").onclick = openAgenda;
    $("hm-run").onclick = async (e) => { const b = e.currentTarget; b.disabled = true; try { await J("/api/agent/run", { method: "POST" }); } catch (x) {} b.disabled = false; feedTick(); };
    $("hm-brief").onclick = async (e) => { const b = e.currentTarget; b.disabled = true; try { await J("/api/agent/run?brief=true", { method: "POST" }); } catch (x) {} b.disabled = false; feedTick(); };
  }

  const DOW = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const MON = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const pad = (n) => String(n).padStart(2, "0");
  function userName() {
    const l = $("u-label");
    const t = l ? l.textContent.replace(/[▸\s]+$/, "").trim() : "";
    return t ? t.charAt(0) + t.slice(1).toLowerCase() : "Nassime";
  }
  function weekNo(d) { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const dn = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dn); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); }
  function clockTick() {
    const d = new Date();
    const h = d.getHours();
    if ($("hm-clock")) {
      $("hm-clock").textContent = pad(h) + ":" + pad(d.getMinutes());
      $("hm-date").textContent = `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
      $("hm-week").textContent = "SEMAINE " + weekNo(d);
      $("hm-hello").innerHTML = `${h < 5 || h >= 19 ? "Bonsoir" : h < 12 ? "Bonjour" : "Salut"}, <b>${esc(userName())}</b>`;
    }
  }

  // --- matériel
  const colorFor = (p) => (p >= 90 ? "#ff3b4f" : p >= 70 ? "#f5a524" : (window.enosAccent ? window.enosAccent("--ac") : "#e0243c"));
  function setGauge(k, pct, sub) {
    const g = $("g-" + k);
    if (!g) return;
    const ok = pct != null;
    g.querySelector(".fg").style.setProperty("--p", ok ? Math.max(1, Math.min(100, pct)) : 0);
    g.querySelector(".fg").style.setProperty("--c", ok ? colorFor(pct) : "#333");
    g.querySelector(".v").textContent = ok ? Math.round(pct) + "%" : "n/d";
    g.querySelector(".s").textContent = sub || "—";
  }
  const last = (a) => { if (!a) return null; for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
  let hwTimer = 0, hwBusy = false;
  async function hwTick() {
    clearTimeout(hwTimer);
    if (view !== "home" || document.hidden) { hwTimer = setTimeout(hwTick, 2000); return; }
    if (!hwBusy) {
      hwBusy = true;
      try {
        const h = await J("/api/sys/history?seconds=30");
        const cpu = last(h.cpu), gpu = last(h.gpu), ram = last(h.ram);
        setGauge("cpu", cpu, h.cpu_mhz && last(h.cpu_mhz) ? (last(h.cpu_mhz) / 1000).toFixed(2) + " GHz" : (h.cores || []).length + " cœurs");
        setGauge("gpu", gpu, last(h.gpu_temp) != null ? `${Math.round(last(h.gpu_temp))} °C · ${last(h.gpu_vram_gb) ?? "?"} Go VRAM` : "indisponible");
        setGauge("ram", ram, last(h.ram_gb) != null ? last(h.ram_gb).toFixed(1) + " Go utilisés" : "");
        const f = (b) => (b == null ? "—" : b > 1048576 ? (b / 1048576).toFixed(1) + " Mo/s" : Math.round(b / 1024) + " Ko/s");
        $("hm-hwfoot").innerHTML = `<span>↓ <b>${f(last(h.net_down))}</b></span><span>↑ <b>${f(last(h.net_up))}</b></span><span>Disque lecture <b>${f(last(h.disk_r))}</b></span><span>Disque écriture <b>${f(last(h.disk_w))}</b></span>${last(h.gpu_w) != null ? `<span>GPU <b>${Math.round(last(h.gpu_w))} W</b></span>` : ""}`;
        $("hm-hwt").textContent = "temps réel";
      } catch (e) { $("hm-hwt").textContent = "capteurs indisponibles"; }
      hwBusy = false;
    }
    hwTimer = setTimeout(hwTick, 2000);
  }

  // --- journée
  const dt = (s) => new Date(s);
  const fmtT = (s) => { const d = dt(s); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  function countdown(ms) {
    if (ms < 0) return "en cours";
    const m = Math.round(ms / 60000);
    if (m < 60) return m + " min";
    const h = Math.floor(m / 60);
    if (h < 24) return h + " h " + (m % 60 ? pad(m % 60) : "");
    const d = Math.floor(h / 24);
    return d + " j " + (h % 24) + " h";
  }
  let dayData = null;
  async function dayTick() {
    try { dayData = await J("/api/agenda/overview?days=14"); } catch (e) { dayData = null; }
    renderDay();
  }
  function renderDay() {
    const el = $("hm-day");
    if (!el) return;
    if (!dayData) { el.innerHTML = '<div class="hm-empty">Agenda indisponible pour le moment.</div>'; return; }
    const now = new Date(), today = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    const items = dayData.items.filter((i) => !i.done);
    const todayIt = items.filter((i) => i.start.slice(0, 10) === today && i.kind !== "deadline" && i.source !== "moodle" && i.kind !== "task");
    const due = items.filter((i) => ["deadline", "exam", "task"].includes(i.kind) && dt(i.end || i.start) > now).slice(0, 5);
    const nextClass = items.find((i) => i.source === "zeus" && dt(i.end) > now);
    const src = dayData.sources || {};
    let html = "";
    if (nextClass) {
      const ms = dt(nextClass.start) - now;
      html += `<div class="hm-next"><div class="cd">${esc(countdown(ms))}</div><div class="t"><b>${esc(nextClass.title)}</b><small>${ms < 0 ? "en cours" : "prochain cours"} · ${fmtT(nextClass.start)}–${fmtT(nextClass.end)}${nextClass.location ? " · " + esc(nextClass.location) : ""}</small></div></div>`;
    }
    const rowT = (i) => `<div class="hm-it ${i.source}${dt(i.end || i.start) < now ? " past" : ""}"><span class="dot"></span><span class="tm">${fmtT(i.start)}</span><span class="n">${esc(i.title)}${i.location ? `<small>${esc(i.location)}</small>` : ""}</span></div>`;
    const rowD = (i) => { const ms = dt(i.start) - now, h = ms / 36e5; return `<div class="hm-it ${i.source}"><span class="dot"></span><span class="n">${esc(i.title)}</span><span class="chip ${h < 24 ? "hot" : h < 72 ? "warm" : ""}">${esc(countdown(ms))}</span></div>`; };
    html += `<div class="hm-cols"><div><h4>Aujourd'hui</h4>${todayIt.length ? todayIt.map(rowT).join("") : `<div class="hm-empty">${src.zeus && src.zeus.configured ? "Aucun cours aujourd'hui." : 'Zeus non relié. <a id="hm-cfg1">Configurer</a>'}</div>`}</div>
      <div><h4>À rendre</h4>${due.length ? due.map(rowD).join("") : `<div class="hm-empty">${src.moodle && src.moodle.configured ? "Aucun rendu en vue." : 'Moodle non relié. <a id="hm-cfg2">Configurer</a>'}</div>`}</div></div>`;
    const errs = ["zeus", "moodle"].filter((k) => src[k] && src[k].error);
    if (errs.length) html += `<div class="hm-empty" style="margin-top:12px">⚠ ${errs.map((k) => k.toUpperCase()).join(" + ")} : actualisation impossible, données en cache.</div>`;
    el.innerHTML = html;
    ["hm-cfg1", "hm-cfg2"].forEach((id) => { if ($(id)) $(id).onclick = () => window.enosAgenda && window.enosAgenda.open(true); });
  }

  // --- flux de l'IA proactive
  async function feedTick() {
    try {
      const s = await J("/api/agent/status");
      $("hm-led").classList.toggle("off", !s.running);
      $("hm-ledt").textContent = s.running ? "active" : "arrêtée";
      if (s.feed && s.feed.length) {
        $("hm-feed").innerHTML = s.feed.slice(0, 8).map((m) => {
          const d = new Date(m.t * 1000);
          return `<div class="hm-msg ${esc(m.level)}"><small>${esc(m.title)} · ${pad(d.getHours())}:${pad(d.getMinutes())}</small>${esc(m.message)}</div>`;
        }).join("");
      }
    } catch (e) { /* hors ligne */ }
  }

  // --- accès rapide (compteur d'usage local)
  const USE_KEY = "enos_mod_use";
  const readUse = () => { try { return JSON.parse(localStorage.getItem(USE_KEY) || "{}"); } catch (e) { return {}; } };
  function bump(id) { try { const u = readUse(); u[id] = (u[id] || 0) + 1; localStorage.setItem(USE_KEY, JSON.stringify(u)); } catch (e) {} }
  function renderQuick() {
    const el = $("hm-quick");
    if (!el) return;
    const u = readUse();
    const mods = collect().sort((a, b) => (u[b.id] || 0) - (u[a.id] || 0));
    const pick = mods.filter((m) => u[m.id]).slice(0, 5);
    for (const m of mods) if (pick.length < 5 && !pick.includes(m)) pick.push(m);
    el.innerHTML = pick.map((m) => `<button class="hm-q" data-id="${esc(m.id)}">${svg(m.icon)}${esc(m.name)}</button>`).join("");
    el.querySelectorAll(".hm-q").forEach((b) => (b.onclick = () => launch(b.dataset.id)));
  }

  // ------------------------------------------------------------------ LANCEUR
  function collect() {
    const out = [{ id: "__agenda", name: "Agenda", sub: "Emploi du temps Zeus · rendus Moodle · tâches · IA proactive", icon: "cal", cat: "school", badge: "NEW" }];
    out.push({ id: "__pair", name: "Appairer le téléphone", sub: "QR code : clés, agenda et jumelage envoyés en un scan", icon: "phone", cat: "sys", badge: "NEW" });
    out.push({ id: "__afk", name: "Smart AFK", sub: "Anti-AFK jeu : micro-mouvements caméra + ZQSD · Échap ou souris = arrêt immédiat", icon: "play", cat: "ia", badge: "PREMIUM" });
    out.push({ id: "__clipper", name: "Auto-Clipper IA", sub: "Moments forts (cri de victoire…) → clip vertical 9:16 · activer / désactiver", icon: "film", cat: "ia", badge: "PREMIUM" });
    out.push({ id: "__setup", name: "Assistant de configuration", sub: "Clés API, agenda, projet Godot, téléphone, YouTube : relancer pas à pas", icon: "gear", cat: "sys" });
    const sec = sideMods();
    if (!sec) return out;
    sec.querySelectorAll("button.btn").forEach((b) => {
      if (b.hidden || getComputedStyle(b).display === "none") return;
      const id = b.id || (b.hasAttribute("data-open-colis") ? "b-colis" : "");
      if (!id) return;
      const small = b.querySelector("small");
      const name = [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").replace(/^\s*\d+\.\s*/, "").trim() || id;
      const m = META[id] || ["grid", "sys"];
      out.push({ id, name, sub: small ? small.textContent.trim() : "", icon: m[0], cat: m[1], el: b });
    });
    return out;
  }
  function launch(id) {
    if (id === "__pair") { closeLx(true); return window.enosPair && window.enosPair.open(); }
    if (id === "__afk" || id === "__clipper") {
      closeLx(true);
      bump(id);
      const afk = id === "__afk", name = afk ? "Smart AFK" : "Auto-Clipper";
      const post = (u, body) => J(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      const call = afk ? post("/api/afk/toggle")
        : J("/api/clipper/status").then((st) => post("/api/clipper/config", { values: { clipper_enabled: !st.running } }));
      return call.then((r) => {
        if (afk && r.ok === false) return toast({ level: "warn", title: name, message: r.error });
        if (afk) { if (r.armed) toast({ level: "info", title: "Smart AFK armé", message: "Lâche la souris et le clavier : il démarre après quelques secondes de calme. Échap annule." }); }      // l'arrêt notifie côté serveur
        else toast({ level: "info", title: name, message: r.clipper_enabled ? "Activé : tampon en mémoire en cours." : "Désactivé." });
      }).catch(() => toast({ level: "warn", title: name, message: "Module indisponible (réservé au PC local)." }));
    }
    if (id === "__setup") { closeLx(true); return window.enosOnboarding && window.enosOnboarding.open(); }
    bump(id);
    closeLx(true);
    if (id === "__agenda") return openAgenda();
    const b = id === "b-colis" ? document.querySelector("[data-open-colis]") : $(id);
    if (b) setTimeout(() => b.click(), 120);
  }
  let lxCat = "all", lxMods = [];
  function buildLx() {
    if ($("lx")) return;
    const d = document.createElement("div");
    d.id = "lx";
    d.hidden = true;
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-label", "Applications");
    d.innerHTML = `<div class="lx-top"><h2>APPLICATIONS</h2>
        <label class="lx-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input id="lx-q" type="search" placeholder="Rechercher un module…" autocomplete="off" spellcheck="false"></label>
        <button class="lx-x" id="lx-x" aria-label="Fermer">✕</button></div>
      <div class="lx-cats" id="lx-cats">${CATS.map(([k, l]) => `<button class="lx-cat${k === "all" ? " on" : ""}" data-c="${k}">${l}</button>`).join("")}</div>
      <div class="lx-grid" id="lx-grid"></div>
      <div class="lx-hint"><kbd>Échap</kbd> fermer · <kbd>Entrée</kbd> lancer le premier résultat · <kbd>Ctrl</kbd>+<kbd>K</kbd> ouvrir/fermer</div>`;
    document.body.appendChild(d);
    $("lx-x").onclick = () => closeLx();
    d.addEventListener("mousedown", (e) => { if (e.target === d || e.target.id === "lx-grid") closeLx(); });
    $("lx-q").oninput = renderLx;
    $("lx-q").onkeydown = (e) => { if (e.key === "Enter") { const t = $("lx-grid").querySelector(".lx-t"); if (t) t.click(); } };
    $("lx-cats").onclick = (e) => { const b = e.target.closest(".lx-cat"); if (!b) return; lxCat = b.dataset.c; $("lx-cats").querySelectorAll(".lx-cat").forEach((x) => x.classList.toggle("on", x === b)); renderLx(); };
    $("lx-grid").addEventListener("pointermove", (e) => {            // le halo suit le curseur
      const t = e.target.closest(".lx-t");
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty("--mx", e.clientX - r.left + "px");
      t.style.setProperty("--my", e.clientY - r.top + "px");
    });
  }
  function renderLx() {
    const q = $("lx-q").value.trim().toLowerCase();
    const u = readUse();
    const favs = new Set(Object.entries(u).sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => x[0]));
    const list = lxMods.filter((m) => (lxCat === "all" || (lxCat === "fav" ? favs.has(m.id) : m.cat === lxCat)) && (!q || (m.name + " " + m.sub).toLowerCase().includes(q)));
    $("lx-grid").innerHTML = list.length
      ? list.map((m, i) => `<button class="lx-t" style="--i:${Math.min(i, 30)}" data-id="${esc(m.id)}">${m.badge ? `<span class="lx-badge">${m.badge}</span>` : ""}<span class="lx-ico">${svg(m.icon)}</span><span class="lx-n">${esc(m.name)}</span><span class="lx-s">${esc(m.sub)}</span></button>`).join("")
      : `<div class="lx-none">${lxCat === "fav" ? "Lance quelques modules : tes favoris apparaîtront ici." : "Aucun module ne correspond."}</div>`;
    $("lx-grid").querySelectorAll(".lx-t").forEach((t) => (t.onclick = () => launch(t.dataset.id)));
  }
  function openLx() {
    buildLx();
    const d = $("lx");
    if (!d.hidden) return;
    document.body.classList.remove("menu-open");
    lxMods = collect();
    lxCat = "all";
    $("lx-cats").querySelectorAll(".lx-cat").forEach((x) => x.classList.toggle("on", x.dataset.c === "all"));
    $("lx-q").value = "";
    d.classList.remove("out");
    d.hidden = false;
    renderLx();
    $("os-apps") && $("os-apps").classList.add("on");
    setTimeout(() => $("lx-q").focus(), 80);
  }
  function closeLx(instant) {
    const d = $("lx");
    if (!d || d.hidden) return;
    $("os-apps") && $("os-apps").classList.remove("on");
    if (instant) { d.hidden = true; return; }
    d.classList.add("out");
    setTimeout(() => { d.hidden = true; d.classList.remove("out"); }, 200);
  }

  // ------------------------------------------------------------------ TOASTS (IA proactive)
  function toast(e) {
    let box = $("hm-toasts");
    if (!box) { box = document.createElement("div"); box.id = "hm-toasts"; box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
    const lvl = e.level === "urgent" ? "" : e.level === "warn" ? "warn" : "info";
    const life = e.level === "urgent" ? 20 : 12;
    const t = document.createElement("div");
    t.className = "hm-toast " + lvl;
    t.style.setProperty("--life", life + "s");
    const acts = (e.actions || []).slice(0, 3);
    t.innerHTML = `<div class="ic">${svg("bell")}</div><div style="min-width:0"><b>${esc(e.title || "E.N.O.S.")}</b><p>${esc(e.message)}</p>` +
      (acts.length ? `<div class="acts">${acts.map((a, i) => `<button type="button" data-a="${i}">${esc(a.label)}</button>`).join("")}</div>` : "") + `</div><i class="bar"></i>`;
    const kill = () => { t.classList.add("out"); setTimeout(() => t.remove(), 300); };
    t.onclick = () => { kill(); if (e.source === "agent") openAgenda(); };
    t.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async (ev) => {          // « Fait » / « Reporter à demain » / « Ouvrir » : sans quitter ce que l'on fait
      ev.stopPropagation();
      const a = acts[+b.dataset.a];
      if (a.verb === "open") { kill(); return openAgenda(); }
      b.disabled = true;
      try {
        const r = await fetch("/api/agenda/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verb: a.verb, id: a.id || "" }) });
        const j = await r.json();
        t.querySelector("p").textContent = r.ok ? j.message : (j.detail || "Action impossible.");
        t.querySelector(".acts").remove(); setTimeout(kill, 2200);
      } catch (x) { b.disabled = false; }
    }));
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(kill, life * 1000);
    feedTick();
  }
  // sans audio ElevenLabs (quota, clé absente) : repli sur la voix du navigateur ; avec audio, notify.js le joue déjà
  function browserSpeak(text) {
    try { const u = new SpeechSynthesisUtterance(text); u.lang = "fr-FR"; u.rate = 1.02; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
  }
  window.addEventListener("enos:notify", (ev) => {
    const e = ev.detail;
    if (!e || e.kind !== "alert") return;
    toast(e);
    if (!e.silent && !(e.voice && e.voice.audio)) browserSpeak(e.message);
  });

  // ------------------------------------------------------------------ clavier : Ctrl+K, Échap, F11
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); const d = $("lx"); d && !d.hidden ? closeLx() : openLx(); }
    else if (e.key === "Escape") { const d = $("lx"); if (d && !d.hidden) closeLx(); }
    else if (e.key === "F11") {
      e.preventDefault();
      if (window.pywebview && window.pywebview.api && window.pywebview.api.toggle_fullscreen) window.pywebview.api.toggle_fullscreen();
      else if (document.fullscreenElement) document.exitFullscreen(); else root.requestFullscreen && root.requestFullscreen();
    }
  });

  // ------------------------------------------------------------------ démarrage
  function init() {
    buildNav(); buildHome(); trimSide();
    setView("home");
    clockTick(); setInterval(clockTick, 5000);
    dayTick(); setInterval(dayTick, 120000); setInterval(renderDay, 30000);
    feedTick(); setInterval(feedTick, 30000);
    renderQuick(); setTimeout(renderQuick, 1500);                                  // 2e passage : certains boutons (dev-only, local-only) sont révélés après l'authentification
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { dayTick(); feedTick(); } });
    // un module lancé depuis le chat ou le tiroir ramène l'utilisateur sur l'accueil quand il se ferme : rien à faire, les panneaux sont des surcouches
    const side = $("side");
    if (side) side.addEventListener("click", (e) => { const b = e.target.closest("button.btn"); if (b && b.id && META[b.id]) bump(b.id); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
