"use strict";
// TABLEAU DE BORD SYSTÈME : profils de performance, Turbo Boost, préférence énergie (powercfg), capteurs, graphiques d'historique.
// Les onglets Diagnostic et Godot sont fournis par sysdiag.js via window.enosSys.register(). Tout est réservé à ce PC.
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const EPP = [["default", "Défaut"], ["perf", "Perf."], ["balanced_plus", "Équ.+"], ["eco", "Éco"], ["min", "Min"]];
  const ICON = { silent: "◔", balanced: "▦", turbo: "⌁" };
  const TABS = [{ id: "overview", title: "Vue d'ensemble" }, { id: "graphs", title: "Graphiques" }];
  const EXTRA = {};                                                  // onglets ajoutés par sysdiag.js : {id: {title, render(pane), onOpen?, onClose?}}
  let timer = 0, busy = false, last = null, askSilent = false, tab = "overview", win = 300, hist = null;
  const isOpen = () => !$("sd").hidden;

  async function api(path, body, method) {
    const m = method || (body ? "POST" : "GET");
    const r = await fetch("/api/sys/" + path, { method: m, headers: { "X-Nasko-Token": TOKEN, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) {
      let d = ""; try { d = (await r.json()).detail; } catch (e) {}
      throw new Error(r.status === 403 ? "Accès refusé (panneau réservé à ce PC)." : d || "Erreur serveur " + r.status);
    }
    return r.json();
  }

  const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d }));
  const bytes = (b, d = 1) => (b == null ? "—" : b >= 2 ** 30 ? num(b / 2 ** 30, d) + " Go" : b >= 2 ** 20 ? num(b / 2 ** 20, d) + " Mo" : b >= 1024 ? num(b / 1024, 0) + " Ko" : num(b, 0) + " o");
  const rate = (b) => (b == null ? "—" : bytes(b) + "/s");
  const row = (label, val) => `<div class="cb-row"><span>${esc(label)}</span><span>${val}</span></div>`;
  const bar = (label, val, pct) => `${row(label, val)}<div class="cb-bar"><i style="--v:${Math.max(0, Math.min(100, pct || 0))}%"></i></div>`;
  function flash(msg, bad) { const m = $("sd-msg"); m.hidden = !msg; m.textContent = msg || ""; m.className = bad ? "bad" : ""; }

  // ------------------------------------------------------------------ graphiques SVG (aire + courbes, grille, valeurs min/moy/max)
  let chartN = 0;
  const niceMax = (v, floor) => { v = Math.max(v * 1.15, floor || 1); const p = 10 ** Math.floor(Math.log10(v)); for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p; return 10 * p; };
  function chart(o) {
    const d = o.data, id = "sdg" + ++chartN, W = 560, H = 170, pl = 46, pr = 10, pt = 12, pb = 22;
    const n = d.t.length;
    const sers = o.series.map((s) => ({ ...s, v: d[s.key] || [] }));
    const has = sers.some((s) => s.v.some((x) => x != null));
    let max = o.max;
    if (max === "auto") max = niceMax(Math.max(0, ...sers.flatMap((s) => s.v.filter((x) => x != null))), o.floor);
    const cur = sers.map((s) => { const a = s.v.filter((x) => x != null); return { s, now: a.length ? a[a.length - 1] : null, avg: a.length ? a.reduce((p, c) => p + c, 0) / a.length : null, mx: a.length ? Math.max(...a) : null }; });
    const head = cur.map((c) => `<span class="sd-leg"><i style="background:${c.s.color}"></i>${esc(c.s.label)} <b>${c.now == null ? "—" : o.fmt(c.now)}</b><small>moy ${c.avg == null ? "—" : o.fmt(c.avg)} · max ${c.mx == null ? "—" : o.fmt(c.mx)}</small></span>`).join("");
    let body;
    if (n < 2 || !has) body = `<div class="sd-empty sd-nochart">${n < 2 ? "Collecte en cours… (un point toutes les 2 s)" : "Mesure indisponible sur ce PC"}</div>`;
    else {
      const t1 = d.t[n - 1], span = Math.max(30, Math.min(win, t1 - d.t[0] + 2)), t0 = t1 - span;
      const X = (t) => pl + ((t - t0) / span) * (W - pl - pr), Y = (v) => pt + (H - pt - pb) * (1 - Math.min(1, Math.max(0, v / max)));
      const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${pl}" x2="${W - pr}" y1="${Y(max * f)}" y2="${Y(max * f)}" class="g"/>${f === 0 || f === 0.5 || f === 1 ? `<text x="${pl - 6}" y="${Y(max * f) + 4}" text-anchor="end">${o.axis(max * f)}</text>` : ""}`).join("");
      const mins = [span, span * 0.75, span * 0.5, span * 0.25, 0].map((s, i) => `<text x="${pl + (W - pl - pr) * i / 4}" y="${H - 5}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}">${s === 0 ? "maintenant" : "−" + (s >= 90 ? Math.round(s / 60) + " min" : Math.round(s) + " s")}</text>`).join("");
      const paths = sers.map((s, si) => {
        let dpath = "", seg = [];
        const flush = () => { if (seg.length > 1) { dpath += "M" + seg.join("L"); } seg = []; };
        s.v.forEach((v, i) => { if (v == null) flush(); else seg.push(X(d.t[i]).toFixed(1) + "," + Y(v).toFixed(1)); });
        flush();
        if (!dpath) return "";
        const first = d.t.findIndex((_, i) => s.v[i] != null);
        const area = si === 0 && o.area !== false ? `<path d="${dpath.replace(/^M/, "M")}L${X(t1).toFixed(1)},${Y(0)}L${X(d.t[first]).toFixed(1)},${Y(0)}Z" fill="url(#${id})" stroke="none"/>` : "";
        return area + `<path d="${dpath}" fill="none" stroke="${s.color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" pathLength="1"/>`;
      }).join("");
      body = `<svg class="sd-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(o.title)}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sers[0].color}" stop-opacity=".38"/><stop offset="1" stop-color="${sers[0].color}" stop-opacity="0"/></linearGradient></defs>${grid}${mins}${paths}</svg>`;
    }
    return `<div class="cb-card sd-gc"><h4>${esc(o.title)}${o.sub ? `<small>${o.sub}</small>` : ""}</h4><div class="sd-legs">${head}</div>${body}${o.extra || ""}</div>`;
  }
  const heat = (p) => `hsl(${Math.round(260 - 260 * Math.min(1, p / 100) * 0.98)} 85% ${42 + Math.min(1, p / 100) * 8}%)`;
  const C = { get red() { return window.enosAccent ? window.enosAccent("--ac") : "#e0243c"; }, violet: "#7a5cf0", amber: "#f2a93b", teal: "#35c2b0", blue: "#4b9bff" };

  function graphs(h) {
    const pct = (v) => num(v, 0) + " %", ax = (v) => num(v, 0), mhz = (v) => num(v, 0) + " MHz", tmp = (v) => num(v, 0) + " °C", w = (v) => num(v, 0) + " W";
    const cores = (h.cores || []).map((p, i) => `<div class="sd-core" title="Cœur ${i}: ${p} %"><i style="height:${Math.max(3, p)}%;background:${heat(p)}"></i></div>`).join("");
    const lastv = (k) => { const a = (h[k] || []).filter((x) => x != null); return a.length ? a[a.length - 1] : null; };
    return `<div class="sd-wins">${[[60, "1 min"], [300, "5 min"], [900, "15 min"]].map(([s, l]) => `<button data-win="${s}" class="${win === s ? "on" : ""}">${l}</button>`).join("")}<span class="sd-note">Un point toutes les 2 s · l'historique se remplit tant que ce panneau est ouvert</span></div>
    <div class="cb-grid sd-charts">
      ${chart({ title: "Processeur", sub: " charge totale", data: h, series: [{ key: "cpu", label: "CPU", color: C.red }], max: 100, fmt: pct, axis: ax, extra: `<div class="sd-cores-h">Charge par cœur logique (${(h.cores || []).length})</div><div class="sd-cores">${cores}</div>` })}
      ${chart({ title: "Fréquence du processeur", data: h, series: [{ key: "cpu_mhz", label: "Fréquence", color: C.amber }], max: "auto", floor: 1000, fmt: mhz, axis: ax })}
      ${chart({ title: "Mémoire RAM", sub: ` ${num(lastv("ram_gb"), 1)} Go · échange ${num(lastv("swap_gb"), 1)} Go`, data: h, series: [{ key: "ram", label: "RAM", color: C.violet }], max: 100, fmt: pct, axis: ax })}
      ${chart({ title: "GPU", sub: " charge et VRAM", data: h, series: [{ key: "gpu", label: "Charge", color: C.red }, { key: "gpu_mem", label: "VRAM", color: C.blue }], max: 100, fmt: pct, axis: ax })}
      ${chart({ title: "Température GPU", data: h, series: [{ key: "gpu_temp", label: "GPU", color: C.amber }], max: 100, fmt: tmp, axis: ax })}
      ${chart({ title: "Puissance GPU", data: h, series: [{ key: "gpu_w", label: "Puissance", color: C.teal }], max: "auto", floor: 20, fmt: w, axis: ax })}
      ${chart({ title: "Réseau", data: h, series: [{ key: "net_down", label: "Réception", color: C.teal }, { key: "net_up", label: "Envoi", color: C.amber }], max: "auto", floor: 50 * 1024, fmt: rate, axis: (v) => bytes(v, 0) })}
      ${chart({ title: "Disque", sub: " débit de lecture et d'écriture", data: h, series: [{ key: "disk_r", label: "Lecture", color: C.blue }, { key: "disk_w", label: "Écriture", color: C.red }], max: "auto", floor: 1024 * 1024, fmt: rate, axis: (v) => bytes(v, 0) })}
    </div>`;
  }

  // ------------------------------------------------------------------ vue d'ensemble (contrôles + capteurs)
  function modes(s) {
    const cur = s.profiles.current;
    const btns = s.profiles.items.map((p) => `<button data-profile="${p.id}" class="${cur === p.id ? "on" : ""}" ${p.available || p.id === "silent" ? "" : "disabled"} title="${p.available ? "" : "Aucun plan d'alimentation correspondant sur ce PC"}"><span class="sd-ico">${ICON[p.id]}</span>${esc(p.label)}${p.available ? "" : "<small>plan absent</small>"}</button>`).join("");
    const ask = askSilent ? `<div class="sd-ask">Ce PC n'a plus de plan « Économie d'énergie ». Créer un plan « E.N.O.S. Silencieux » depuis le modèle Windows ?
      <button class="btn" id="sd-create">CRÉER ET ACTIVER</button><button class="btn" id="sd-nocreate">ANNULER</button></div>` : "";
    return `<h3 class="sd-h">Mode de fonctionnement <small>plan actif : ${esc(s.profiles.active_name || "—")}${cur === "custom" ? " (personnalisé)" : ""}</small></h3><div class="cb-modes" id="sd-modes">${btns}</div>${ask}`;
  }
  function processor(s) {
    const t = s.turbo, e = s.epp, c = s.sensors.cpu;
    const turbo = t.supported
      ? `<div class="sd-line"><span>Turbo Boost</span><div class="cb-switch ${t.enabled ? "on" : ""}" id="sd-turbo" role="switch" aria-checked="${!!t.enabled}" tabindex="0" title="${t.mode === 2 ? "Mode offensif actif" : ""}"></div></div>`
      : `<div class="sd-line"><span>Turbo Boost</span><em>non géré</em></div>`;
    const epp = e.supported
      ? `<div class="sd-sub">Préférence énergie <small>(secteur : ${num(e.ac)} %, batterie : ${num(e.dc)} %)</small></div><div class="cb-seg" id="sd-epp">${EPP.map(([k, l]) => `<button data-epp="${k}" class="${e.preset === k ? "on" : ""}">${l}</button>`).join("")}</div>`
      : "";
    return `<div class="cb-card"><h4>Processeur</h4>${turbo}${epp}
      ${row("Fréquence", num(c.mhz) + " MHz")}${row("Cœurs logiques", num(c.logical))}${c.temp != null ? row("Température", num(c.temp) + " °C") : ""}</div>`;
  }
  function usage(s) {
    const c = s.sensors.cpu, g = s.sensors.gpu, r = s.sensors.ram, b = s.sensors.battery, d = s.sensors.disk;
    const gpu = g ? `<div class="cb-card"><h4>GPU <small>${esc(g.name)}</small></h4>${row("Fréquence", num(g.mhz) + " MHz")}${bar("Utilisation", num(g.util) + " %", g.util)}
      ${bar("Mémoire", num(g.mem_used_mb / 1024, 1) + " / " + num(g.mem_total_mb / 1024, 1) + " Go", g.mem_total_mb ? g.mem_used_mb / g.mem_total_mb * 100 : 0)}
      ${row("Température", num(g.temp) + " °C")}${row("Puissance", num(g.watts, 1) + " W")}</div>`
      : `<div class="cb-card"><h4>GPU</h4><div class="sd-empty">nvidia-smi indisponible</div></div>`;
    const mem = `<div class="cb-card"><h4>Mémoire</h4>${bar("RAM", num(r.used_gb, 1) + " / " + num(r.total_gb, 1) + " Go", r.pct)}
      ${d ? bar("Stockage (C:)", num(d.used_gb, 0) + " / " + num(d.total_gb, 0) + " Go", d.pct) : ""}
      ${b ? row("Batterie", num(b.pct) + " %" + (b.plugged ? " · secteur" : "")) : ""}</div>`;
    const cpu = `<div class="cb-card"><h4>CPU</h4>${bar("Utilisation", num(c.util) + " %", c.util)}${row("Fréquence", num(c.mhz) + " MHz")}</div>`;
    return cpu + gpu + mem;
  }
  function fans(s) {
    const f = s.sensors.fans;
    if (!f || !f.length) return `<div class="cb-card"><h4>Ventilateurs</h4><div class="sd-empty">${esc(s.notes.fans_read)}.<br>Pour les voir : lancez LibreHardwareMonitor et activez « Options › Serveur web distant ».</div></div>`;
    return `<div class="cb-grid">${f.map((x) => `<div class="cb-card sd-fan"><h4>${esc(x.name)}</h4>
      <svg class="cb-gauge" viewBox="0 0 170 170"><circle class="bg"/><circle class="fg" style="--p:${Math.min(1, x.rpm / 6000)}"/></svg>
      <div class="sd-rpm"><b>${num(x.rpm)}</b><small>RPM</small></div></div>`).join("")}</div><div class="sd-foot">Lecture seule : ${esc(s.notes.fans_write)}.</div>`;
  }
  function overview(s) { return `${modes(s)}<div class="cb-grid">${processor(s)}${usage(s)}</div>${fans(s)}`; }

  // ------------------------------------------------------------------ coque : onglets, rafraîchissement
  function tabsBar() {
    const all = [...TABS, ...Object.entries(EXTRA).map(([id, t]) => ({ id, title: t.title }))];
    return `<div class="cb-modes sd-tabs" id="sd-tabs">${all.map((t) => `<button data-tab="${t.id}" class="${tab === t.id ? "on" : ""}">${esc(t.title)}</button>`).join("")}</div>`;
  }
  function paint() {
    const main = $("sd-main");
    if (!main.querySelector("#sd-tabs")) main.innerHTML = tabsBar() + '<div id="sd-pane"></div>';
    else main.querySelector("#sd-tabs").outerHTML = tabsBar();
    const pane = $("sd-pane");
    if (tab === "overview") pane.innerHTML = last ? overview(last) : '<div class="sd-empty">Lecture des capteurs…</div>';
    else if (tab === "graphs") pane.innerHTML = hist ? graphs(hist) : '<div class="sd-empty">Chargement de l\'historique…</div>';
  }
  async function refresh() {
    if (busy || !isOpen()) return;
    if (tab !== "overview" && tab !== "graphs") return;
    busy = true;
    try {
      const first = tab === "overview" ? !last : !hist;                      // 1re arrivée des données de l'onglet : on joue la cascade
      if (tab === "overview") last = await api("state"); else hist = await api("history?seconds=" + win);
      flash(""); paint();
      if (first && window.enosMotion) window.enosMotion.reveal($("sd-pane"));
    } catch (e) { flash("⚠ " + e.message, true); }
    busy = false;
  }
  function selectTab(id) {
    const prev = EXTRA[tab]; if (prev && prev.onClose) prev.onClose();
    tab = id; clearInterval(timer);
    const mo = () => { if (window.enosMotion) window.enosMotion.reveal($("sd-pane")); };
    if (EXTRA[id]) { paint(); const pane = $("sd-pane"); EXTRA[id].render(pane); if (EXTRA[id].onOpen) EXTRA[id].onOpen(pane); mo(); return; }
    paint(); mo(); refresh();
    timer = setInterval(refresh, 2500);
  }
  async function act(path, body) {
    if (busy) return;
    busy = true;
    try { last = await api(path, body); flash(""); paint(); }
    catch (e) { flash("⚠ " + e.message, true); }
    busy = false;
  }

  function open() { $("sd").hidden = false; $("sd-main").innerHTML = ""; selectTab(tab); }
  function close() { $("sd").hidden = true; clearInterval(timer); const x = EXTRA[tab]; if (x && x.onClose) x.onClose(); }

  window.enosSys = { api, esc, num, bytes, rate, row, bar, flash, chart, register(id, def) { EXTRA[id] = def; } };

  function init() {
    if (!$("b-sys")) return;
    $("b-sys").onclick = open;
    $("sd-close").onclick = close;
    $("sd").addEventListener("click", (e) => {
      const t = e.target.closest("[data-tab]");
      if (t) { selectTab(t.dataset.tab); return; }
      const w = e.target.closest("[data-win]");
      if (w) { win = +w.dataset.win; hist = null; paint(); refresh(); return; }
      if (tab !== "overview") return;
      const p = e.target.closest("[data-profile]"), ep = e.target.closest("[data-epp]");
      if (p && !p.disabled) {
        if (p.dataset.profile === "silent" && last && !last.profiles.items.find((i) => i.id === "silent").available) { askSilent = true; paint(); return; }
        act("profile", { profile: p.dataset.profile });
      } else if (ep) act("epp", { preset: ep.dataset.epp });
      else if (e.target.closest("#sd-turbo")) act("turbo", { enabled: !(last && last.turbo.enabled) });
      else if (e.target.closest("#sd-create")) { askSilent = false; act("profile", { profile: "silent", create_if_missing: true }); }
      else if (e.target.closest("#sd-nocreate")) { askSilent = false; paint(); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) close(); });
  }
  init();
})();
