"use strict";
// VOICE CHANGER (interface) : choix de la voix (54 prédéfinies + « mes voix »), curseurs de réglage en direct, périphériques (micro -> câble audio virtuel), « je m'entends »,
// niveaux et visualiseur temps réel. Tout le traitement audio est fait par nasko_voicemod.py ; ici, uniquement l'interface.
(() => {
  const $ = (id) => document.getElementById(id);
  if (!$("vm")) return;
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  async function api(path, body) {
    const r = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { "X-Nasko-Token": TOKEN, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || r.statusText);
    return j;
  }
  const HUES = { naturel: 140, fun: 45, robot: 190, radio: 28, horreur: 320, fx: 265, persos: 356, user: 160 };
  const GROUPS = ["VOIX", "HARMONIES", "MODULATION", "SATURATION", "ESPACE", "FILTRES", "SORTIE"];
  let cat = { presets: [], cats: [], params: [], user: [], favs: [] }, dev = { inputs: [], outputs: [] };
  let cur = { id: "", params: {} }, running = false, bypass = false, tab = "all", q = "", st = null, loaded = false, timer = 0, sendT = 0, busy = false, last = {};
  const defaults = () => Object.fromEntries(cat.params.map((p) => [p.key, p.default]));
  const all = () => cat.presets.concat(cat.user.map((u) => ({ id: u.id, name: u.name, cat: "user", emoji: "⭐", tag: "Ta voix personnalisée", params: u.params, user: true })));
  const byId = (id) => all().find((p) => p.id === id);

  // ---------------------------------------------------------------- chargement
  async function load() {
    try {
      [cat, dev, st] = await Promise.all([api("/api/voicemod/catalog"), api("/api/voicemod/devices"), api("/api/voicemod/state")]);
    } catch (e) { $("vm-err").textContent = e.message; return; }
    last = cat.last || {};
    running = st.running; bypass = st.bypass;
    cur.id = st.preset && st.preset !== "custom" ? st.preset : last.preset || "";
    cur.params = { ...defaults(), ...(running ? st.params : (byId(cur.id) || { params: {} }).params) };
    drawDevices(); drawCats(); drawCards(); drawSliders(); syncNow(); syncPower();
    loaded = true;
  }
  function drawDevices() {
    const opt = (list, sel, none) => (none ? `<option value="-1">${none}</option>` : "") + list.map((d) => `<option value="${d.id}" ${String(d.id) === String(sel) ? "selected" : ""}>${esc(d.name)}${d.virtual ? "  ★ câble virtuel" : ""}</option>`).join("");
    const virt = dev.outputs.find((o) => o.virtual);
    const inSel = last.input != null && dev.inputs.some((d) => d.id === last.input) ? last.input : dev.default_in;
    const outSel = last.output != null && dev.outputs.some((d) => d.id === last.output) ? last.output : virt ? virt.id : dev.default_out;
    $("vm-in").innerHTML = opt(dev.inputs, inSel);
    $("vm-out").innerHTML = opt(dev.outputs, outSel);
    $("vm-mon").innerHTML = opt(dev.outputs.filter((o) => !o.virtual), last.monitor != null ? last.monitor : -1, "— Je ne m'entends pas —");
    $("vm-mg").value = Math.round((last.monitor_gain != null ? last.monitor_gain : 0.8) * 100);
    const box = $("vm-cable");
    if (virt) {
      box.className = "vm-cable ok";
      box.innerHTML = `<b>✔ Câble audio virtuel détecté</b> : « ${esc(virt.name)} ».<br>Dans Discord, OBS, Teams, un jeu… choisis <b>« CABLE Output »</b> (ou « VoiceMeeter Output ») comme <b>microphone</b> : les autres entendront la voix modifiée.`;
    } else {
      box.className = "vm-cable no";
      box.innerHTML = `<b>⚠ Aucun câble audio virtuel trouvé.</b> Windows ne laisse pas un programme remplacer le micro sans pilote.<ol><li>Installe <b>VB-CABLE</b> (gratuit), puis redémarre le PC.</li><li>Ici : sortie = « CABLE Input ».</li><li>Dans Discord / OBS : micro = « CABLE Output ».</li></ol><button class="vm-btn pri" id="vm-getcable" type="button">TÉLÉCHARGER VB-CABLE</button><br>En attendant, tu peux t'entendre (« Je m'entends ») et écouter un aperçu.`;
      $("vm-getcable").onclick = () => window.open("https://vb-audio.com/Cable/", "_blank", "noopener");
    }
  }

  // ---------------------------------------------------------------- catégories + cartes
  function counts() {
    const n = { all: all().length, fav: all().filter((p) => cat.favs.includes(p.id)).length, user: cat.user.length };
    all().forEach((p) => { n[p.cat] = (n[p.cat] || 0) + 1; });
    return n;
  }
  function drawCats() {
    const n = counts();
    const tabs = [["all", "TOUTES", "🎛"], ["fav", "FAVORIS", "★"], ...cat.cats.map((c) => [c.id, c.name, c.emoji]), ["user", "MES VOIX", "⭐"]];
    $("vm-cats").innerHTML = tabs.map(([id, nm, em]) => `<button class="vm-cat${tab === id ? " on" : ""}" data-t="${id}" type="button">${em} ${esc(nm)}<b>${n[id] || 0}</b></button>`).join("");
  }
  function drawCards() {
    const list = all().filter((p) => (tab === "all" || (tab === "fav" ? cat.favs.includes(p.id) : p.cat === tab)) && (!q || (p.name + " " + p.tag).toLowerCase().includes(q)));
    const box = $("vm-cards");
    if (!list.length) { box.innerHTML = `<div class="vm-empty">${tab === "user" ? "Règle les curseurs puis « ENREGISTRER COMME MA VOIX »." : tab === "fav" ? "Clique sur ★ pour garder tes voix préférées ici." : "Aucune voix ne correspond."}</div>`; return; }
    box.innerHTML = list.map((p, i) => {
      const pt = (((p.params.pitch || 0) + 12) / 24) * 100;
      return `<div class="vm-card${cur.id === p.id ? " on" : ""}" role="button" tabindex="0" data-id="${esc(p.id)}" style="--cc:hsl(${HUES[p.cat] || 200} 100% 62%);animation-delay:${Math.min(i, 18) * 22}ms">
        <button class="st${cat.favs.includes(p.id) ? " on" : ""}" data-fav="${esc(p.id)}" type="button" aria-label="Favori">${cat.favs.includes(p.id) ? "★" : "☆"}</button>
        <div class="em">${p.emoji}</div><div class="nm">${esc(p.name)}</div><div class="tg">${esc(p.tag)}</div>
        <div class="pt">GRAVE<u><i style="left:${pt}%"></i></u>AIGU</div>
        <div class="eqb"><u></u><u></u><u></u><u></u></div>${p.user ? `<button class="vm-del" data-del="${esc(p.id)}" type="button" title="Supprimer">🗑</button>` : ""}</div>`;
    }).join("");
  }
  async function pick(id) {
    const p = byId(id);
    if (!p) return;
    cur = { id, params: { ...defaults(), ...p.params }, custom: false };
    drawCards(); drawSliders(); syncNow();
    if (running) { try { st = await api("/api/voicemod/params", { preset: id, params: id.startsWith("user:") ? {} : {} }); } catch (e) { $("vm-err").textContent = e.message; } }
    else api("/api/voicemod/prefs", { preset: id }).catch(() => {});
  }
  function syncNow() {
    const p = byId(cur.id);
    $("vm-now-n").textContent = bypass ? "Voix normale (bypass)" : p ? p.name : cur.custom ? "Voix personnalisée" : "Choisis une voix";
    $("vm-now-t").textContent = bypass ? "Ta vraie voix passe sans traitement" : p ? p.tag : "Réglages manuels";
  }

  // ---------------------------------------------------------------- curseurs
  const fmt = (p, v) => (p.step < 1 ? Number(v).toFixed(1) : Math.round(v)) + p.unit;
  function drawSliders() {
    const d = defaults();
    $("vm-acc").innerHTML = GROUPS.map((g, gi) => `<div class="vm-acc${gi === 0 ? " open" : ""}" data-g="${g}"><button type="button">${g}</button><div>${cat.params.filter((p) => p.group === g).map((p) => {
      const v = cur.params[p.key] != null ? cur.params[p.key] : p.default;
      return `<div class="vm-sl${v !== d[p.key] ? " chg" : ""}" data-k="${p.key}"><label><span>${esc(p.label)}</span><b>${fmt(p, v)}</b></label><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" style="--p:${((v - p.min) / (p.max - p.min)) * 100}%"></div>`;
    }).join("")}</div></div>`).join("");
  }
  function onSlide(e) {
    const row = e.target.closest(".vm-sl");
    if (!row) return;
    const p = cat.params.find((x) => x.key === row.dataset.k), v = +e.target.value;
    cur.params[p.key] = v;
    row.querySelector("b").textContent = fmt(p, v);
    row.classList.toggle("chg", v !== p.default);
    e.target.style.setProperty("--p", ((v - p.min) / (p.max - p.min)) * 100 + "%");
    cur.custom = true;
    if (cur.id && !byId(cur.id)?.user) { cur.id = ""; drawCards(); }
    syncNow();
    clearTimeout(sendT);
    sendT = setTimeout(() => { if (running) api("/api/voicemod/params", { params: { [p.key]: v } }).catch(() => {}); }, 40);
  }

  // ---------------------------------------------------------------- marche / arrêt
  function syncPower() {
    const b = $("vm-power");
    b.classList.toggle("on", running); b.setAttribute("aria-pressed", running);
    b.querySelector("span").textContent = running ? "ACTIF" : "ACTIVER";
    $("vm-byp").classList.toggle("on", bypass);
    const c = $("vm-chip");
    c.className = "vm-chip" + (running ? (bypass ? " byp" : " on") : "");
    c.textContent = running ? (bypass ? "BYPASS" : "EN DIRECT") : "ARRÊT";
    $("vm-prev").disabled = running;
    syncNow();
  }
  async function power() {
    if (busy) return;
    busy = true; $("vm-power").classList.add("busy"); $("vm-err").textContent = "";
    try {
      if (running) st = await api("/api/voicemod/stop", {});
      else {
        st = await api("/api/voicemod/start", { input: +$("vm-in").value, output: +$("vm-out").value, monitor: +$("vm-mon").value, monitor_gain: +$("vm-mg").value / 100, preset: cur.id, params: cur.params });
      }
      running = st.running; bypass = st.bypass;
    } catch (e) { $("vm-err").textContent = e.message; running = false; }
    busy = false; $("vm-power").classList.remove("busy"); syncPower();
  }

  // ---------------------------------------------------------------- visualiseur + sondage
  const cv = $("vm-cv"), g = cv.getContext("2d");
  let spec = new Array(32).fill(0), wave = new Array(64).fill(0), t0 = performance.now(), raf = 0;
  function draw(now) {
    raf = requestAnimationFrame(draw);
    if ($("vm").hidden) return;
    const W = (cv.width = cv.clientWidth * 1.5), H = (cv.height = cv.clientHeight * 1.5), t = (now - t0) / 1000;
    g.clearRect(0, 0, W, H);
    const h = (HUES[(byId(cur.id) || {}).cat] || 330), n = 32, bw = W / n;
    for (let i = 0; i < n; i++) {
      const idle = 0.06 + 0.05 * Math.sin(t * 2 + i * 0.5), v = Math.max(running ? spec[i] : 0, idle), bh = Math.min(1, v) * H * 0.72;
      const gr = g.createLinearGradient(0, H / 2 - bh, 0, H / 2 + bh);
      gr.addColorStop(0, `hsla(${h},100%,65%,.95)`); gr.addColorStop(0.5, `hsla(${h + 60},100%,70%,.55)`); gr.addColorStop(1, `hsla(${h},100%,65%,.95)`);
      g.fillStyle = gr;
      const x = i * bw + bw * 0.15, r = bw * 0.35;
      g.beginPath(); g.roundRect ? g.roundRect(x, H / 2 - bh / 2, bw * 0.7, Math.max(4, bh), r) : g.rect(x, H / 2 - bh / 2, bw * 0.7, Math.max(4, bh)); g.fill();
    }
    g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 2; g.shadowColor = `hsl(${h},100%,60%)`; g.shadowBlur = 14; g.beginPath();
    for (let i = 0; i < 64; i++) { const y = H / 2 + (running ? wave[i] : Math.sin(t * 3 + i * 0.35) * 0.04) * H * 0.9, x = (i / 63) * W; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.shadowBlur = 0;
  }
  async function poll() {
    if ($("vm").hidden) return;
    try {
      st = await api("/api/voicemod/state");
      running = st.running; bypass = st.bypass;
      spec = st.spec; wave = st.wave;
      const lv = (x) => Math.min(100, Math.sqrt(x) * 160);
      $("vm-lin").style.width = lv(st.lvl_in) + "%"; $("vm-lout").style.width = lv(st.lvl_out) + "%";
      $("vm-stat").innerHTML = running ? `Latence ≈ <b>${st.latency_ms} ms</b> · CPU <b>${Math.round(st.cpu * 100)} %</b> · actif depuis <b>${Math.floor(st.uptime / 60)}:${String(st.uptime % 60).padStart(2, "0")}</b>` : "Prêt. Choisis une voix puis ACTIVER.";
      if (st.error && !running) $("vm-err").textContent = st.error;
      syncPower();
    } catch (e) { /* serveur occupé : on réessaie */ }
  }
  const open = async () => { $("vm").hidden = false; if (!loaded) await load(); else { try { dev = await api("/api/voicemod/devices"); drawDevices(); } catch (e) { /* ignoré */ } } clearInterval(timer); timer = setInterval(poll, 110); poll(); if (!raf) raf = requestAnimationFrame(draw); };
  const close = () => { $("vm").hidden = true; clearInterval(timer); };

  // ---------------------------------------------------------------- événements
  $("b-vm").onclick = open; $("vm-close").onclick = close;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("vm").hidden) close(); });
  $("vm-power").onclick = power;
  $("vm-cats").onclick = (e) => { const b = e.target.closest(".vm-cat"); if (b) { tab = b.dataset.t; drawCats(); drawCards(); } };
  $("vm-q").oninput = (e) => { q = e.target.value.trim().toLowerCase(); drawCards(); };
  $("vm-cards").onclick = async (e) => {
    const f = e.target.closest("[data-fav]"), d = e.target.closest("[data-del]"), c = e.target.closest(".vm-card");
    if (f) { const id = f.dataset.fav; cat.favs = cat.favs.includes(id) ? cat.favs.filter((x) => x !== id) : cat.favs.concat(id); api("/api/voicemod/prefs", { favs: cat.favs }).catch(() => {}); drawCats(); drawCards(); return; }
    if (d) { cat.user = (await api("/api/voicemod/user/delete", { id: d.dataset.del })).user; if (cur.id === d.dataset.del) cur.id = ""; drawCats(); drawCards(); return; }
    if (c) pick(c.dataset.id);
  };
  $("vm-cards").onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("vm-card")) { e.preventDefault(); pick(e.target.dataset.id); } };
  $("vm-acc").addEventListener("input", onSlide);
  $("vm-acc").onclick = (e) => { const b = e.target.closest(".vm-acc>button"); if (b) b.parentElement.classList.toggle("open"); };
  $("vm-reset").onclick = () => { cur = { id: "", params: defaults(), custom: false }; drawCards(); drawSliders(); syncNow(); if (running) api("/api/voicemod/params", { params: cur.params }).catch(() => {}); };
  $("vm-byp").onclick = async () => { bypass = !bypass; syncPower(); if (running) api("/api/voicemod/params", { bypass }).catch(() => {}); };
  $("vm-mg").oninput = (e) => { api("/api/voicemod/params", { monitor_gain: +e.target.value / 100 }).catch(() => {}); };
  ["vm-in", "vm-out", "vm-mon"].forEach((id) => ($(id).onchange = () => api("/api/voicemod/prefs", { input: +$("vm-in").value, output: +$("vm-out").value, monitor: +$("vm-mon").value, monitor_gain: +$("vm-mg").value / 100 }).catch(() => {})));
  $("vm-prev").onclick = async () => {
    $("vm-err").textContent = "";
    try { await api("/api/voicemod/params", { preset: cur.id.startsWith("user:") ? "" : cur.id, params: cur.params }); await api("/api/voicemod/preview", { input: +$("vm-in").value, output: +($("vm-mon").value > -1 ? $("vm-mon").value : $("vm-out").value), seconds: 4 }); $("vm-err").textContent = "🎙 Parle pendant 4 secondes… la lecture suit."; }
    catch (e) { $("vm-err").textContent = e.message; }
  };
  $("vm-saveb").onclick = async () => {
    const name = $("vm-name").value.trim();
    try { cat.user = (await api("/api/voicemod/user", { name, params: cur.params })).user; $("vm-name").value = ""; cur.id = "user:" + name; tab = "user"; drawCats(); drawCards(); syncNow(); $("vm-err").textContent = ""; }
    catch (e) { $("vm-err").textContent = e.message; }
  };
  $("vm-rescan").onclick = async () => { try { dev = await api("/api/voicemod/devices"); drawDevices(); } catch (e) { $("vm-err").textContent = e.message; } };
})();
