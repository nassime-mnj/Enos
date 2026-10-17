"use strict";
// Vues : ACCUEIL (horloge, agenda du jour, rendus), CHAT (ENOS / ETO, flux), PC (déverrouillé par link.js).
(() => {
  const E = window.ENOS, $ = E.$, esc = E.esc, pad = E.pad, G = E.agenda, A = E.ai, U = E.ui;
  const DOW = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const MON = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

  // ================================================================== ACCUEIL
  const hm = (s) => s.slice(11, 16);
  const countdown = (ms) => { if (ms < 0) return "en cours"; const m = Math.round(ms / 60000); if (m < 60) return m + " min"; const h = Math.floor(m / 60); return h < 24 ? h + " h " + pad(m % 60) : Math.floor(h / 24) + " j " + (h % 24) + " h"; };
  const localISO = (d) => `${E.ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  function clock() {
    const d = new Date(), h = d.getHours();
    $("#h-clock").textContent = pad(h) + ":" + pad(d.getMinutes());
    $("#h-date").textContent = `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
    $("#h-hello").innerHTML = `${h < 5 || h >= 19 ? "Bonsoir" : h < 12 ? "Bonjour" : "Salut"}, <b>${esc(A.name())}</b>`;
  }

  function renderDay() {
    const now = new Date(), today = E.ymd(now), nowS = localISO(now);
    const tomorrow = E.ymd(new Date(now.getTime() + 864e5)), in14 = E.ymd(new Date(now.getTime() + 14 * 864e5));
    const todays = G.items(today + "T00:00", tomorrow + "T00:00").filter((i) => i.source === "zeus" || i.kind === "task");
    const due = G.items(nowS.slice(0, 11) + "00:00", in14 + "T00:00").filter((i) => (i.kind === "deadline" || i.kind === "exam" || i.kind === "task") && !i.done && i.end >= nowS).slice(0, 6);
    const next = G.items(nowS, in14 + "T00:00").find((i) => i.source === "zeus" && i.end > nowS) || G.items(today + "T00:00", in14 + "T00:00").find((i) => i.source === "zeus" && i.end > nowS);
    $("#h-next").hidden = !next;
    if (next) {
      const ms = new Date(next.start) - now;
      $("#h-next-cd").textContent = countdown(ms);
      $("#h-next-t").textContent = next.title;
      $("#h-next-s").textContent = `${ms < 0 ? "en cours" : "prochain cours"} · ${hm(next.start)}–${hm(next.end)}${next.location ? " · " + next.location : ""}`;
    }
    const row = (i) => `<div class="it ${i.source}${i.end < nowS ? " past" : ""}${i.done ? " done" : ""}" ${i.kind === "task" ? `data-task="${esc(i.id)}"` : ""}>${i.kind === "task" ? '<span class="chk"></span>' : '<span class="dot"></span>'}<span class="tm">${hm(i.start)}</span><span class="n">${esc(i.title)}${i.location ? `<small>${esc(i.location)}</small>` : ""}</span></div>`;
    $("#h-day").innerHTML = todays.length ? todays.map(row).join("") : `<div class="empty">${N_has("zeus") || G.liveTasks().length ? "Rien de prévu aujourd'hui." : "Ajoute ton lien Zeus dans les réglages, ou crée une tâche."}</div>`;
    $("#h-due").innerHTML = due.length ? due.map((i) => { const h = (new Date(i.start) - now) / 36e5; return `<div class="it ${i.source}" ${i.kind === "task" ? `data-task="${esc(i.id)}"` : ""}><span class="dot"></span><span class="n">${esc(i.title)}</span><span class="tag ${h < 24 ? "hot" : h < 72 ? "warm" : ""}">${esc(countdown(new Date(i.start) - now))}</span></div>`; }).join("") : `<div class="empty">${N_has("moodle") ? "Aucun rendu en vue." : "Moodle non relié (Réglages)."}</div>`;
  }
  const N_has = (s) => E.native.vault.has("ics_" + s);

  function initHome() {
    clock(); setInterval(clock, 15000);
    E.on("agenda", renderDay); setInterval(renderDay, 30000);
    $("#h-day").addEventListener("click", (e) => { const t = e.target.closest("[data-task]"); if (t) { G.toggleTask(t.dataset.task); E.vibrate(10); } });
    U.longPress($("#h-day"), "[data-task]", (el) => U.sheet({ title: "Tâche", options: [{ label: "Supprimer", cls: "bad", fn: () => G.deleteTask(el.dataset.task) }] }));
    $("#h-ag-open").onclick = async () => {
      const title = await U.prompt("Nouvelle tâche", "Ex. Rendre le TP de C", "", "AJOUTER");
      if (!title || !title.trim()) return;
      const due = await U.prompt("Échéance (facultatif)", "AAAA-MM-JJ HH:MM", "", "OK");
      const m = (due || "").trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
      G.addTask(title, m ? `${m[1]}T${pad(+(m[2] || 9))}:${m[3] || "00"}` : localISO(new Date()));
      U.toast("Tâche ajoutée", "ok");
    };
    E.$$("[data-go=chat]").forEach((b) => (b.onclick = () => { setPersona(b.dataset.persona); U.go("chat"); }));
    renderDay();
  }

  // ================================================================== CHAT
  let persona = E.settings.get("persona", "enos"), sending = false;
  const box = () => $("#msgs");
  function addMsg(role, text, who) {
    const d = document.createElement("div");
    d.className = "msg " + role;
    if (role === "a") d.innerHTML = `<small>${esc(who || A.PERSONAS[persona].label)}</small><span class="t"></span>`;
    (role === "a" ? d.querySelector(".t") : d).textContent = text;
    box().appendChild(d);
    box().scrollTop = box().scrollHeight;
    return d;
  }
  function renderChat() {
    box().innerHTML = "";
    const h = A.history(persona);
    if (!h.length) addMsg("sys", A.configured() ? `${A.PERSONAS[persona].label} est prêt. Parle-lui.` : "Ajoute ta clé Groq dans Réglages ⚙ pour discuter, sans le PC.");
    h.forEach((m) => addMsg(m.role === "user" ? "u" : "a", m.content));
    $("#inp").placeholder = "Parle à " + A.PERSONAS[persona].label + "…";
  }
  function setPersona(p) {
    if (sending) return;
    persona = p;
    E.settings.set("persona", p);
    $("#persona-seg").dataset.p = p;
    E.$$("#persona-seg button").forEach((b) => b.classList.toggle("on", b.dataset.p === p));
    renderChat();
  }
  async function send() {
    const inp = $("#inp"), text = inp.value.trim();
    if (!text || sending) return;
    sending = true; inp.value = ""; grow();
    A.stopVoice();
    const sys = box().querySelector(".msg.sys"); if (sys) sys.remove();
    addMsg("u", text);
    const bub = addMsg("a", "");
    const t = bub.querySelector(".t");
    t.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    E.vibrate(10);
    try {
      const reply = await A.chat(persona, text, (partial) => { t.textContent = partial; box().scrollTop = box().scrollHeight; });
      t.textContent = reply;
      if (A.voiceOn()) A.speak(persona, reply);
    } catch (e) { bub.remove(); addMsg("sys", e.message); }
    sending = false;
  }
  function grow() { const i = $("#inp"); i.style.height = "auto"; i.style.height = Math.min(130, i.scrollHeight) + "px"; }
  function initChat() {
    $("#persona-seg").dataset.p = persona;
    E.$$("#persona-seg button").forEach((b) => { b.classList.toggle("on", b.dataset.p === persona); b.onclick = () => setPersona(b.dataset.p); });
    $("#btn-send").onclick = send;
    $("#inp").oninput = grow;
    $("#inp").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
    const vb = $("#btn-voice");
    vb.setAttribute("aria-pressed", A.voiceOn());
    vb.onclick = () => { const on = !A.voiceOn(); E.settings.set("voice", on); vb.setAttribute("aria-pressed", on); if (!on) A.stopVoice(); U.toast(on ? "Voix activée" : "Voix coupée"); };
    // appui long sur un message : copier / réécouter / supprimer la conversation
    U.longPress(box(), ".msg.a,.msg.u", (el) => {
      const txt = (el.querySelector(".t") || el).textContent;
      U.sheet({ title: "Message", options: [
        { label: "Réécouter", fn: () => A.speak(persona, txt) },
        { label: "Copier le texte", fn: () => { try { navigator.clipboard.writeText(txt); U.toast("Copié", "ok"); } catch (e) { U.toast("Copie impossible", "warn"); } } },
        { label: "Effacer cette conversation", cls: "bad", fn: () => { A.clear(persona); renderChat(); } }] });
    });
    E.on("settings", (k) => { if (k === "name" || k === "model") renderChat(); });
    E.on("tab", (t) => { if (t === "chat") setTimeout(renderChat, 0); });
    renderChat();
  }

  // ================================================================== PC
  const col = (p) => (p >= 90 ? "#ff3b4f" : p >= 70 ? "#f5a524" : "#e0243c");
  function gauge(id, pct, sub) {
    const g = $("#" + id), ok = pct != null;
    const fg = g.querySelector(".fg");
    fg.style.setProperty("--p", ok ? Math.max(1, Math.min(100, pct)) : 0);
    fg.style.setProperty("--c", ok ? col(pct) : "#333");
    g.querySelector(".v").textContent = ok ? Math.round(pct) + "%" : "n/d";
    g.querySelector(".s").textContent = sub || "";
  }
  const bar = (label, val, pct) => `<div class="bar-row"><div class="t"><span>${esc(label)}</span><b>${esc(val)}</b></div><div class="b"><i style="--v:${Math.max(0, Math.min(100, pct || 0))}%"></i></div></div>`;
  function up(s) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h >= 24 ? Math.floor(h / 24) + " j " + (h % 24) + " h" : h + " h " + pad(m); }

  function paintPc(s) {
    $("#pc-host").textContent = s.host;
    $("#pc-sub").textContent = `E.N.O.S. ${s.version} · allumé depuis ${up(s.uptime_s)}`;
    $("#pc-via").textContent = E.link.via || "LAN";
    $("#pc-profile").textContent = s.profile ? String(s.profile).toUpperCase() : "";
    const c = s.cpu || {}, g = s.gpu || {}, r = s.ram || {};
    gauge("g-cpu", c.util, [c.mhz ? (c.mhz / 1000).toFixed(1) + " GHz" : "", c.temp != null ? Math.round(c.temp) + " °C" : ""].filter(Boolean).join(" · "));
    gauge("g-gpu", g.util, g.temp != null ? `${Math.round(g.temp)} °C${g.mem_used_mb != null ? " · " + (g.mem_used_mb / 1024).toFixed(1) + " Go" : ""}` : "");
    gauge("g-ram", r.pct, r.used_gb != null ? `${r.used_gb}/${r.total_gb} Go` : "");
    let bars = "";
    if (s.disk) bars += bar("Disque C:", `${s.disk.used_gb}/${s.disk.total_gb} Go`, s.disk.pct);
    if (s.battery) bars += bar("Batterie", s.battery.pct + "%" + (s.battery.plugged ? " ⚡" : ""), s.battery.pct);
    if (g.watts != null) bars += bar("GPU conso", Math.round(g.watts) + " W", Math.min(100, g.watts / 0.5));
    $("#pc-bars").innerHTML = bars;
    const fans = Array.isArray(s.fans) ? s.fans : [];
    $("#pc-fans-card").hidden = false;
    $("#pc-fans").innerHTML = fans.length ? fans.map((f) => `<div class="it"><span class="n">${esc(f.name || "Ventilateur")}</span><span class="tag">${f.rpm != null ? Math.round(f.rpm) + " tr/min" : "—"}</span></div>`).join("")
      : '<div class="empty">Lecture indisponible : installe LibreHardwareMonitor (serveur web) sur le PC. Le réglage de la vitesse passe par le contrôleur du constructeur et n\'est pas pilotable à distance.</div>';
    const run = s.running || [];
    $("#pc-stop").hidden = !run.length;
    $("#pc-running").textContent = run.length ? "En cours : " + run.map((x) => x.name || x.rel || x).join(", ") : "Aucune scène en cours";
  }

  let scenesLoaded = false;
  async function loadScenes() {
    if (scenesLoaded) return;
    try {
      const r = await E.link.api("/api/godot/scenes");
      const j = r.json() || {};
      const sc = j.scenes || j.items || (Array.isArray(j) ? j : []);
      scenesLoaded = true;
      $("#pc-scenes").innerHTML = sc.length ? sc.slice(0, 60).map((s) => { const rel = s.rel || s.path || s; return `<div class="scene"><span class="n">${esc(s.name || String(rel).split("/").pop())}</span><button class="go" data-rel="${esc(rel)}" aria-label="Lancer"><svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg></button></div>`; }).join("") : '<div class="empty">Aucune scène trouvée (projet actif du PC).</div>';
    } catch (e) { $("#pc-scenes").innerHTML = '<div class="empty">Scènes indisponibles.</div>'; }
  }

  function applyLink() {
    const L = E.link, on = L.state === "online";
    const chip = $("#link-chip");
    chip.className = "chip " + (on ? "on" : L.state === "probing" ? "probing" : "off");
    chip.querySelector("span").textContent = on ? "PC en ligne" : L.state === "probing" ? "Recherche…" : L.state === "unpaired" ? "PC non appairé" : L.state === "denied" ? "Non approuvé" : "PC hors ligne";
    $("#brand-sub").textContent = on ? "CONNECTÉ · " + (L.snap ? L.snap.host : "PC") : "AUTONOME";
    $("#app").classList.toggle("app-connected", on);
    $("#tab-pc").classList.toggle("pc-off", !on);
    $("#pc-locked").hidden = on; $("#pc-live").hidden = !on;
    const msg = { unpaired: "Aucun PC appairé : renseigne l'adresse, le jeton et valide l'empreinte du certificat (Réglages).", probing: "Recherche de ton PC sur le Wi-Fi et via Tailscale…",
      offline: "PC injoignable. Il est peut-être éteint — l'application continue en mode autonome et reteste toute seule.", denied: L.error }[L.state];
    if (msg) $("#pc-locked-msg").textContent = msg;
    if (on) { paintPc(L.snap); loadScenes(); } else scenesLoaded = false;
    if (E.ui.tab() === "pc") L.watch(on);
  }

  function initPc() {
    E.on("link", applyLink);
    E.on("pc-snapshot", (s) => { if (E.link.state === "online") paintPc(s); });
    E.on("tab", (t) => { E.link.watch(t === "pc" && E.link.state === "online"); if (t === "pc" && E.link.state !== "online") E.link.probeNow(); });
    E.on("pc-booted", (s) => U.toast("Ton PC vient de démarrer : " + s.host, "ok", 6000));
    $("#link-chip").onclick = () => { if (E.link.state === "online") U.go("pc"); else { U.toast("Recherche du PC…"); E.link.probeNow(); U.go("pc"); } };
    $("#pc-retry").onclick = () => { E.link.probeNow(); E.vibrate(10); };
    $("#pc-wake").onclick = () => E.native.wake();
    $("#pc-setup").onclick = () => E.settingsUi.open("pc");
    $("#pc-fullui").onclick = () => E.native.openPcUi();
    $("#pc-scenes").addEventListener("click", async (e) => {
      const b = e.target.closest(".go");
      if (!b) return;
      E.vibrate(15);
      const r = await E.link.api("/api/godot/run", { method: "POST", body: { rel: b.dataset.rel } });
      const j = r.json() || {};
      U.toast(r.status === 200 && j.ok !== false ? "Scène lancée sur le PC" : (j.message || j.detail || "Lancement refusé"), r.status === 200 && j.ok !== false ? "ok" : "warn");
      E.link.watch(true);
    });
    $("#pc-stop").onclick = async () => { await E.link.api("/api/godot/stop", { method: "POST", body: {} }); U.toast("Scène arrêtée", "ok"); E.link.watch(true); };
    E.$$("[data-power]").forEach((b) => (b.onclick = async () => {
      const act = b.dataset.power;
      const pin = await U.prompt(act === "sleep" ? "Mettre le PC en veille" : "Éteindre le PC", "Code d'accès du PC", "", "ENVOYER");
      if (!pin) return;
      const r = await E.link.api("/api/power/request", { method: "POST", body: { action: act, pin } });
      const j = r.json() || {};
      U.toast(r.status === 200 ? (j.label || act) + " dans quelques secondes (annulable sur le PC)" : j.detail || "Refusé", r.status === 200 ? "ok" : "warn", 5000);
    }));
    applyLink();
  }

  E.views = { init() { initHome(); initChat(); initPc(); }, renderDay, setPersona };
})();
