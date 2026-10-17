"use strict";
// Module AGENDA : timeline semaine / jour (Zeus + Moodle + tâches), glisser-déposer magnétique, particules de complétion, code couleur d'urgence.
// Données : /api/agenda/*, /api/epita/*. Les cours Zeus et les rendus Moodle sont en lecture seule ; seules les tâches perso se déplacent / se redimensionnent.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const hm = (min) => pad(Math.floor(min / 60) % 24) + ":" + pad(Math.round(min % 60));
  const HH = 52;                                                    // px par heure
  const SNAP = 15;                                                  // pas de la grille (minutes)
  const MAG = 11;                                                   // portée de l'aimant (px)
  const DAYS = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];
  const MON = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const REDUCED = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let weekStart = mondayOf(new Date()), focus = new Date(), view = "week", data = null, timer = 0, busy = false, again = false, g = { h0: 8, h1: 19 }, drag = null, tasksCache = [];

  function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  async function api(path, method, body) {
    const r = await fetch(path, { method: method || "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) { let d = ""; try { d = (await r.json()).detail; } catch (e) {} throw new Error(d || "Erreur " + r.status); }
    return r.json();
  }
  function msg(text, ok) { const m = $("ag-msg"); m.hidden = !text; m.textContent = text || ""; m.className = "ag-msg" + (ok ? " ok" : ""); if (text) setTimeout(() => { m.hidden = true; }, 6000); }

  // ------------------------------------------------------------------ urgence : couleur selon le temps restant (tâches, rendus, contrôles ; les cours gardent leur teinte Zeus)
  const U = { late: ["#ff2d55", "EN RETARD"], hot: ["#ff7a1a", "URGENT"], warm: ["#f5c000", "AUJOURD'HUI"], soon: ["#3ddc97", "BIENTÔT"], calm: ["#4cc3ff", "PLUS TARD"], done: ["#5b5b66", "FAIT"] };
  function urgency(i, now) {
    if (i.done) return "done";
    if (i.source === "zeus" && i.kind !== "exam") return "";
    if (!i.start) return "calm";
    const end = new Date(i.end || i.start).getTime(), start = new Date(i.start).getTime();
    if (end < now && start < now) return "late";
    const m = (start - now) / 60000;
    return m <= 120 ? "hot" : m <= 1440 ? "warm" : m <= 4320 ? "soon" : "calm";
  }
  function rel(ms) {
    const a = Math.abs(ms) / 60000, s = ms < 0 ? "il y a " : "dans ";
    if (a < 1) return "maintenant";
    if (a < 90) return s + Math.round(a) + " min";
    if (a < 2880) return s + Math.round(a / 60) + " h";
    return s + Math.round(a / 1440) + " j";
  }

  // ------------------------------------------------------------------ particules de complétion (canvas plein écran, ignoré si « réduire les animations »)
  let parts = [], fxRaf = 0;
  function fxCanvas() {
    const c = $("ag-fx"); if (!c) return null;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(innerWidth * dpr) || c.height !== Math.round(innerHeight * dpr)) { c.width = Math.round(innerWidth * dpr); c.height = Math.round(innerHeight * dpr); }
    return c;
  }
  function burst(x, y, color, big) {
    if (REDUCED() || !fxCanvas()) return;
    const n = big ? 120 : 34, cols = [color, "#ffffff", "#ffd84a", (window.enosAccent ? window.enosAccent("--ac2") : "#ff4d63")];
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, sp = (big ? 4 : 2.2) + Math.random() * (big ? 9 : 5);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (big ? 3 : 1.5), r: 2 + Math.random() * 3.2, life: 1, d: 0.014 + Math.random() * 0.016, c: k % 4 ? color : cols[k % cols.length], sq: Math.random() < 0.4, rot: Math.random() * 6 });
    }
    parts.push({ ring: true, x, y, r: 6, life: 1, d: 0.05, c: color });
    if (!fxRaf) fxRaf = requestAnimationFrame(fxStep);
  }
  function fxStep() {
    const c = fxCanvas(); if (!c) { parts = []; fxRaf = 0; return; }
    const ctx = c.getContext("2d"), dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.life > 0);
    for (const p of parts) {
      p.life -= p.d;
      ctx.globalAlpha = Math.max(0, p.life);
      if (p.ring) { p.r += 3.4; ctx.strokeStyle = p.c; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.3); ctx.stroke(); continue; }
      p.vy += 0.16; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.rot += 0.2;
      ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = 8;
      if (p.sq) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.3); ctx.fill(); }
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    fxRaf = parts.length ? requestAnimationFrame(fxStep) : 0;
    if (!parts.length) ctx.clearRect(0, 0, innerWidth, innerHeight);
  }
  const centerOf = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

  // ------------------------------------------------------------------ construction
  function build() {
    if ($("ag")) return;
    const s = document.createElement("section");
    s.id = "ag"; s.hidden = true; s.setAttribute("role", "dialog"); s.setAttribute("aria-label", "Agenda");
    s.innerHTML = `<div class="ag-top"><h2>AGENDA</h2>
        <div class="ag-nav"><button class="ag-b sq" id="ag-prev" aria-label="Précédent">◂</button><span id="ag-range"></span><button class="ag-b sq" id="ag-next" aria-label="Suivant">▸</button><button class="ag-b" id="ag-today">AUJOURD'HUI</button></div>
        <div class="ag-seg" role="tablist" aria-label="Vue"><button id="ag-vw" class="on" role="tab">SEMAINE</button><button id="ag-vd" role="tab">JOUR</button></div>
        <span class="ag-sp"></span><button class="ag-b" id="ag-refresh">⟳ ACTUALISER</button><button class="ag-b pri" id="ag-close">✕ FERMER</button></div>
      <div class="ag-body">
        <section class="ag-card"><h3>Timeline<span class="sp" id="ag-info"></span></h3><div class="ag-week" id="ag-week"></div>
          <div class="ag-legend"><span class="lg-t">URGENCE</span><span><i style="background:${U.late[0]}"></i>Retard</span><span><i style="background:${U.hot[0]}"></i>&lt; 2 h</span><span><i style="background:${U.warm[0]}"></i>&lt; 24 h</span><span><i style="background:${U.soon[0]}"></i>&lt; 3 j</span><span><i style="background:${U.calm[0]}"></i>Plus tard</span>
            <span class="lg-t" style="margin-left:14px">SOURCE</span><span><i style="background:var(--ac)"></i>Cours (Zeus)</span><span><b class="tag">M</b>Rendu (Moodle)</span><span><b class="tag p">•</b>Tâche perso : glisse-la pour la déplacer</span></div></section>
        <div class="ag-side">
          <section class="ag-card"><h3>Tâches<span class="sp" id="ag-prog"></span></h3>
            <button class="ag-b pri" type="button" id="ag-syl" style="width:calc(100% - 28px);margin:12px 14px 0" title="Importer un PDF de planning ou de plan de cours : l'IA remplit l'agenda">⚡ IMPORTER UN PLAN DE COURS</button>
            <form class="ag-form" id="ag-form"><input id="ag-t" placeholder="Nouvelle tâche…" maxlength="200" required autocomplete="off"><div class="r"><input id="ag-d" type="datetime-local" style="flex:1"><button class="ag-b pri" type="submit">AJOUTER</button></div></form>
            <div class="ag-bar" id="ag-bar"><i></i></div>
            <div class="ag-tasks" id="ag-tasks"></div><p class="ag-hint">Glisse une tâche (⠿) sur la timeline pour la planifier.</p></section>
          <section class="ag-card"><h3>Sources<span class="sp" id="ag-srcinfo"></span></h3><div class="ag-src" id="ag-src"></div><div class="ag-msg" id="ag-msg" hidden></div>
            <form class="ag-cfg" id="ag-cfg" autocomplete="off">
              <label>LIEN D'EXPORT ZEUS (.ics)</label><input id="ag-zeus" type="password" placeholder="https://zeus.ionis-it.com/api/group/…/ics" spellcheck="false">
              <label>MOODLE : LIEN D'EXPORT DU CALENDRIER (.ics)</label><input id="ag-mics" type="password" placeholder="https://moodle…/calendar/export_execute.php?userid=…&authtoken=…" spellcheck="false">
              <p>Les liens contiennent ton jeton : ils sont stockés uniquement sur ce PC (nasko_config.json), jamais renvoyés à l'écran. Zeus : Mon planning → Exporter. Moodle : Calendrier → Importer ou exporter → Exporter → copier l'URL. Champ vide = inchangé.</p>
              <button class="ag-b pri" type="submit">ENREGISTRER</button></form></section>
        </div></div><canvas id="ag-fx" aria-hidden="true"></canvas>`;
    document.body.appendChild(s);
    $("ag-close").onclick = close;
    $("ag-syl").onclick = () => window.enosSyllabus && window.enosSyllabus.open();
    const go = (n) => { const old = ymd(weekStart); if (view === "week") focus = new Date(focus.getFullYear(), focus.getMonth(), focus.getDate() + 7 * n); else focus = new Date(focus.getFullYear(), focus.getMonth(), focus.getDate() + n); weekStart = mondayOf(focus); if (ymd(weekStart) !== old) load(); else render(); };
    $("ag-prev").onclick = () => go(-1);
    $("ag-next").onclick = () => go(1);
    $("ag-today").onclick = () => { const old = ymd(weekStart); focus = new Date(); weekStart = mondayOf(focus); $("ag-week").dataset.scrolled = ""; if (ymd(weekStart) !== old) load(); else render(); };
    $("ag-refresh").onclick = () => load(true);
    const setView = (v) => { view = v; $("ag-vw").classList.toggle("on", v === "week"); $("ag-vd").classList.toggle("on", v === "day"); $("ag-week").dataset.scrolled = ""; render(); };
    $("ag-vw").onclick = () => setView("week");
    $("ag-vd").onclick = () => setView("day");
    $("ag-form").onsubmit = async (e) => {
      e.preventDefault();
      try { await api("/api/agenda/tasks", "POST", { title: $("ag-t").value, due: $("ag-d").value }); $("ag-t").value = ""; $("ag-d").value = ""; await load(); }
      catch (x) { msg(x.message); }
    };
    $("ag-cfg").onsubmit = async (e) => {
      e.preventDefault();
      const body = {};
      if ($("ag-zeus").value.trim()) body.zeus_ics_url = $("ag-zeus").value.trim();
      if ($("ag-mics").value.trim()) body.moodle_ics_url = $("ag-mics").value.trim();
      if (!Object.keys(body).length) return msg("Rien à enregistrer.");
      try { await api("/api/epita/config", "POST", body); $("ag-zeus").value = ""; $("ag-mics").value = ""; msg("Sources enregistrées. Synchronisation…", true); await load(true); }
      catch (x) { msg(x.message); }
    };
    const wk = $("ag-week");
    wk.addEventListener("pointerdown", onDown);
    wk.addEventListener("click", onWeekClick);
    wk.addEventListener("keydown", onKey);
    $("ag-tasks").addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !s.hidden && !($("lx") && !$("lx").hidden)) { if (drag) cancelDrag(); else close(); } });
    window.addEventListener("resize", () => fxCanvas());
  }

  // ------------------------------------------------------------------ rendu de la timeline
  const visibleDays = () => view === "day" ? [new Date(focus.getFullYear(), focus.getMonth(), focus.getDate())] : [...Array(7)].map((_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));

  function lanes(evs) {                                            // chevauchements : colonnes côte à côte au lieu d'un empilement illisible
    evs.sort((a, b) => a.s - b.s || b.e - a.e);
    let cluster = [], end = -1;
    const flush = () => { const n = cluster.reduce((m, x) => Math.max(m, x.lane + 1), 1); cluster.forEach((x) => (x.n = n)); cluster = []; };
    for (const x of evs) {
      if (cluster.length && x.s >= end) { flush(); end = -1; }
      const used = new Set(cluster.filter((c) => c.e > x.s).map((c) => c.lane));
      x.lane = 0; while (used.has(x.lane)) x.lane++;
      cluster.push(x); end = Math.max(end, x.e);
    }
    flush();
  }

  function render() {
    if (!data) return;
    const days = visibleDays(), now = Date.now(), todayS = ymd(new Date());
    const timed = data.items.filter((i) => i.start);
    let h0 = 8, h1 = 19;
    for (const i of timed) {
      const s = new Date(i.start), sm = s.getHours() * 60 + s.getMinutes(), em = Math.min(1440, Math.max(sm + 30, sm + Math.round((new Date(i.end || i.start) - s) / 60000)));
      h0 = Math.min(h0, Math.floor(sm / 60)); h1 = Math.max(h1, Math.ceil(em / 60));
    }
    h0 = Math.max(0, h0); h1 = Math.min(24, Math.max(h1, h0 + 6)); g = { h0, h1 };
    const colH = (h1 - h0) * HH;
    const a = days[0], b = days[days.length - 1];
    $("ag-range").textContent = view === "day" ? `${DAYS[(a.getDay() + 6) % 7]} ${a.getDate()} ${MON[a.getMonth()]} ${a.getFullYear()}` : `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`;
    const cols = days.map((d) => {
      const ds = ymd(d);
      const list = timed.filter((i) => i.start.slice(0, 10) === ds).map((i) => {
        const s = new Date(i.start), e = new Date(i.end || i.start), sm = s.getHours() * 60 + s.getMinutes();
        return { i, s: sm, e: Math.min(1440, Math.max(sm + 30, Math.round((e - s) / 60000) + sm)) };
      });
      lanes(list);
      const evs = list.map(({ i, s, e, lane, n }) => {
        const top = Math.max(0, (s - h0 * 60) / 60 * HH), ht = Math.max(30, (e - s) / 60 * HH - 2);
        const u = urgency(i, now), manual = i.source === "manual";
        const cls = ["ag-ev", i.source, i.kind === "exam" ? "exam" : "", i.done ? "done" : "", u ? "u-" + u : "", manual ? "mv" : ""].join(" ");
        const real = new Date(i.end || i.start) - new Date(i.start);
        const time = real > 0 ? `${hm(s)}–${hm(s + Math.round(real / 60000))}` : hm(s);
        const tag = i.source === "moodle" ? '<b class="tag">M</b>' : i.source === "zeus" ? "" : "";
        const ck = manual ? `<button class="ag-ck" data-ck="${esc(i.task_id)}" aria-label="${i.done ? "Rouvrir" : "Terminer"}">${i.done ? "✓" : ""}</button>` : "";
        const rs = manual ? '<i class="ag-rs" aria-hidden="true"></i>' : "";
        const style = `top:${top}px;height:${ht}px;left:calc(${lane / n * 100}% + 3px);width:calc(${100 / n}% - 6px);` + (u ? `--u:${U[u][0]};` : "");
        return `<div class="${cls}" style="${style}" data-id="${esc(i.id)}" ${manual ? `data-task="${esc(i.task_id)}" tabindex="0"` : ""} title="${esc(i.title)}${manual ? " — glisser pour déplacer" : ""}">${ck}<div class="tx"><b>${tag}${esc(i.title)}</b><small>${time}${i.location ? " · " + esc(i.location) : ""}${u && u !== "done" && manual ? " · " + rel(new Date(i.start) - now) : ""}</small></div>${rs}</div>`;
      }).join("");
      let nowLine = "";
      if (ds === todayS) { const n = new Date(), y = ((n.getHours() * 60 + n.getMinutes()) - h0 * 60) / 60 * HH; if (y >= 0 && y <= colH) nowLine = `<div class="ag-now" style="top:${y}px"></div>`; }
      return `<div class="ag-col${ds === todayS ? " today" : ""}" data-d="${ds}" style="height:${colH}px;--hh:${HH}px">${nowLine}${evs}</div>`;
    }).join("");
    const hours = [...Array(h1 - h0 + 1)].map((_, i) => `<span style="top:${i * HH}px">${pad(h0 + i)}h</span>`).join("");
    $("ag-week").innerHTML = `<div class="ag-wk ${view}" style="grid-template-columns:48px repeat(${days.length},minmax(${view === "day" ? 300 : 112}px,1fr))"><div class="ag-head"><div></div>${days.map((d) => `<div class="${ymd(d) === todayS ? "today" : ""}">${DAYS[(d.getDay() + 6) % 7]}<b>${d.getDate()}</b></div>`).join("")}</div>
      <div class="ag-hours" style="height:${colH}px">${hours}</div>${cols}</div>`;
    const wk = $("ag-week");
    if (!wk.dataset.scrolled) { wk.scrollTop = Math.max(0, (new Date().getHours() - h0 - 1) * HH); wk.dataset.scrolled = "1"; }
    $("ag-info").textContent = `${timed.length} élément${timed.length > 1 ? "s" : ""}`;
    renderSources();
  }

  function renderSources() {
    const s = data.sources || {};
    const row = (k, label) => {
      const x = s[k] || {};
      const cls = !x.configured ? "" : x.error ? "err" : "ok";
      const st = !x.configured ? "non relié" : x.error ? "cache · " + esc(x.error).slice(0, 40) : x.age_s === 0 ? "à jour" : "il y a " + Math.round((x.age_s || 0) / 60) + " min";
      return `<div class="ag-s ${cls}"><i></i><b>${label}</b><small>${st}</small></div>`;
    };
    $("ag-src").innerHTML = row("zeus", "Zeus · emploi du temps") + row("moodle", "Moodle · rendus");
  }

  // ------------------------------------------------------------------ liste des tâches
  function renderTasks() {
    const now = Date.now(), tasks = tasksCache.slice();
    const key = (t) => (t.due ? new Date(t.due).getTime() : 9e15);
    tasks.sort((x, y) => (x.done - y.done) || key(x) - key(y));
    $("ag-tasks").innerHTML = tasks.length ? tasks.map((t) => {
      const it = { start: t.due, end: t.due, source: "manual", kind: "task", done: t.done };
      const u = urgency(it, now), col = U[u][0];
      const due = t.due ? new Date(t.due).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "sans date";
      const chip = t.done ? "" : t.due ? `<em style="--u:${col}">${rel(new Date(t.due) - now)}</em>` : "";
      return `<div class="ag-task u-${u}${t.done ? " done" : ""}" data-id="${t.id}" style="--u:${col}"><span class="ag-grip" data-grip="${t.id}" title="Glisser sur la timeline" aria-label="Déplacer">⠿</span><input type="checkbox" data-id="${t.id}" ${t.done ? "checked" : ""} aria-label="Terminée"><div class="t"><b>${esc(t.title)}</b><small class="${u === "late" ? "late" : ""}">${due}</small></div>${chip}<button data-del="${t.id}" aria-label="Supprimer">✕</button></div>`;
    }).join("") : '<div class="ag-none">Aucune tâche. Ajoute-en une : l\'IA te préviendra avant l\'échéance.</div>';
    const today = ymd(new Date()), td = tasksCache.filter((t) => (t.due || "").slice(0, 10) === today), dn = td.filter((t) => t.done).length;
    $("ag-prog").textContent = td.length ? `AUJOURD'HUI ${dn}/${td.length}` : "";
    $("ag-bar").firstElementChild.style.width = (td.length ? dn / td.length * 100 : 0) + "%";
    $("ag-bar").hidden = !td.length;
    $("ag-tasks").querySelectorAll("input[data-id]").forEach((c) => (c.onchange = () => toggleDone(c.dataset.id, c.checked, c)));
    $("ag-tasks").querySelectorAll("button[data-del]").forEach((c) => (c.onclick = async () => { try { await api("/api/agenda/tasks/" + c.dataset.del, "DELETE"); await load(); } catch (e) { msg(e.message); } }));
  }
  async function loadTasks() {
    try { tasksCache = (await api("/api/agenda/tasks")).tasks; } catch (e) { tasksCache = []; }
    renderTasks();
  }

  // ------------------------------------------------------------------ terminer une tâche : animation + particules (mise à jour optimiste, le serveur confirme ensuite)
  async function toggleDone(tid, done, srcEl) {
    const t = tasksCache.find((x) => x.id === tid); if (t) t.done = done;
    const it = data && data.items.find((x) => x.task_id === tid); if (it) it.done = done;
    const col = done ? "#3ddc97" : (window.enosAccent ? window.enosAccent("--ac2") : "#ff4d63");
    if (done && srcEl) {
      const [x, y] = centerOf(srcEl); burst(x, y, col, false);
      const today = ymd(new Date()), td = tasksCache.filter((x2) => (x2.due || "").slice(0, 10) === today);
      if (t && (t.due || "").slice(0, 10) === today && td.length > 1 && td.every((x2) => x2.done)) { burst(innerWidth / 2, innerHeight / 3, "#ffd84a", true); msg("Journée bouclée : tout est fait. 🎉", true); }
    }
    const ev = document.querySelector(`#ag-week .ag-ev[data-task="${tid}"]`); if (ev) ev.classList.toggle("done", done);
    renderTasks();
    try { await api("/api/agenda/tasks/" + tid, "PATCH", { done }); setTimeout(() => !drag && load(), done ? 650 : 0); } catch (e) { msg(e.message); load(); }
  }
  function onWeekClick(e) {
    const ck = e.target.closest("[data-ck]"); if (!ck) return;
    const ev = ck.closest(".ag-ev"), done = !ev.classList.contains("done");
    toggleDone(ck.dataset.ck, done, ck);
    if (done) { ck.textContent = "✓"; ck.classList.add("pop"); }
  }

  // ------------------------------------------------------------------ glisser-déposer magnétique
  const itemsOfDay = (ds, skipTask) => (data ? data.items : []).filter((i) => i.start && i.start.slice(0, 10) === ds && i.task_id !== skipTask).map((i) => {
    const s = new Date(i.start), e = new Date(i.end || i.start), sm = s.getHours() * 60 + s.getMinutes();
    return [sm, Math.max(sm + 30, sm + Math.round((e - s) / 60000))];
  });

  // minutes de début les plus proches : grille de 15 min, puis aimant sur les bords des autres éléments et sur l'heure actuelle
  function snapStart(ds, rawMin, dur, skipTask) {
    let best = Math.round(rawMin / SNAP) * SNAP, guide = null, bd = Infinity;
    const cands = [];
    for (const [s, e] of itemsOfDay(ds, skipTask)) cands.push([s, s], [e, e], [s - dur, s], [e - dur, e]);
    if (ds === ymd(new Date())) { const n = new Date(); const nm = n.getHours() * 60 + n.getMinutes(); cands.push([nm, nm]); }
    for (const [c, line] of cands) { const d = Math.abs(c - rawMin) / 60 * HH; if (d <= MAG && d < bd) { bd = d; best = c; guide = line; } }
    const lo = g.h0 * 60, hi = g.h1 * 60 - SNAP;
    best = Math.max(lo, Math.min(hi, best));
    return { start: best, guide: bd < Infinity ? guide : null };
  }
  function colAt(x) {
    const cols = [...document.querySelectorAll("#ag-week .ag-col")]; if (!cols.length) return null;
    let near = cols[0], nd = Infinity;
    for (const c of cols) { const r = c.getBoundingClientRect(); const d = x < r.left ? r.left - x : x >= r.right ? x - r.right : 0; if (d < nd) { nd = d; near = c; } }
    return near;
  }
  function overGrid(x, y) { const w = $("ag-week").getBoundingClientRect(); return x >= w.left && x <= w.right && y >= w.top + 40 && y <= w.bottom; }

  function onDown(e) {
    if (e.button !== 0 || drag) return;
    const rs = e.target.closest(".ag-rs"), ev = e.target.closest(".ag-ev.mv"), grip = e.target.closest("[data-grip]");
    if (e.target.closest("[data-ck]")) return;
    if (rs && ev) return startDrag(e, "resize", ev.dataset.task, ev);
    if (ev) return startDrag(e, "move", ev.dataset.task, ev);
    if (grip) return startDrag(e, "task", grip.dataset.grip, grip.closest(".ag-task"));
  }
  function startDrag(e, mode, tid, el) {
    const t = tasksCache.find((x) => x.id === tid), it = data && data.items.find((x) => x.task_id === tid);
    const r = el.getBoundingClientRect();
    const dur = Math.max(it && it.end && it.start ? Math.round((new Date(it.end) - new Date(it.start)) / 60000) : 0, t && t.duration_min || 0);
    drag = { mode, tid, el, x0: e.clientX, y0: e.clientY, grabY: e.clientY - r.top, grabX: e.clientX - r.left, w: r.width, h: r.height, dur, shown: Math.max(30, dur || 60), on: false, id: e.pointerId, cur: { x: r.left, y: r.top }, tgt: null, col: (it && (it.u)) || "#4cc3ff" };
    const u = it ? urgency(it, Date.now()) : "calm"; drag.col = (U[u] || U.calm)[0];
    document.addEventListener("pointermove", onMove); document.addEventListener("pointerup", onUp); document.addEventListener("pointercancel", cancelDrag);
    if (mode !== "task") e.preventDefault();
  }
  function ensureGhost() {
    if (drag.ghost) return;
    const d = drag;
    if (d.mode === "resize") { d.el.classList.add("sizing"); d.startMin = (() => { const s = new Date(data.items.find((x) => x.task_id === d.tid).start); return s.getHours() * 60 + s.getMinutes(); })(); return; }
    const gh = document.createElement("div");
    gh.className = "ag-ev drag" + (d.mode === "task" ? " chip" : ""); gh.style.setProperty("--u", d.col);
    const title = d.mode === "task" ? (tasksCache.find((x) => x.id === d.tid) || {}).title : (data.items.find((x) => x.task_id === d.tid) || {}).title;
    gh.innerHTML = `<div class="tx"><b>${esc(title || "")}</b><small></small></div>`;
    gh.style.cssText += `;left:${d.cur.x}px;top:${d.cur.y}px;width:${d.w}px;height:${d.mode === "task" ? 44 : d.h}px`;
    $("ag").appendChild(gh); d.ghost = gh;
    const lp = document.createElement("div"); lp.className = "ag-land"; lp.style.setProperty("--u", d.col); lp.hidden = true; lp.innerHTML = "<span></span>"; d.land = lp;
    if (d.mode === "move") d.el.classList.add("lifted");
    document.body.classList.add("ag-dragging");
    d.raf = requestAnimationFrame(follow);
  }
  function onMove(e) {
    const d = drag; if (!d || e.pointerId !== d.id) return;
    if (!d.on) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return; d.on = true; ensureGhost(); }
    d.px = e.clientX; d.py = e.clientY;
    if (d.mode === "resize") return resizeTo(e);
    // cible : colonne + minute magnétique
    if (!overGrid(e.clientX, e.clientY)) { d.tgt = null; if (d.land) d.land.hidden = true; return; }
    const col = colAt(e.clientX), r = col.getBoundingClientRect();
    const dur = d.dur || (d.mode === "task" ? 60 : 30), raw = g.h0 * 60 + (e.clientY - d.grabY * (d.mode === "task" ? 0.3 : 1) - r.top) / HH * 60;
    const sn = snapStart(col.dataset.d, raw, d.shown, d.mode === "move" ? d.tid : "");
    d.tgt = { ds: col.dataset.d, start: sn.start, guide: sn.guide, col, magnet: sn.guide != null };
    const lp = d.land; if (lp.parentNode !== col) col.appendChild(lp);
    lp.hidden = false; lp.classList.toggle("mag", d.tgt.magnet);
    lp.style.top = (sn.start - g.h0 * 60) / 60 * HH + "px"; lp.style.height = Math.max(30, d.shown / 60 * HH - 2) + "px";
    lp.firstChild.textContent = `${hm(sn.start)}–${hm(sn.start + (dur || 30))}`;
    let gl = col.querySelector(".ag-guide");
    if (sn.guide != null) { if (!gl) { gl = document.createElement("div"); gl.className = "ag-guide"; col.appendChild(gl); } gl.style.top = (sn.guide - g.h0 * 60) / 60 * HH + "px"; }
    document.querySelectorAll("#ag-week .ag-guide").forEach((x) => { if (x !== gl) x.remove(); });
    if (d.lastMag !== d.tgt.magnet && d.tgt.magnet) lp.animate([{ transform: "scale(1.04)" }, { transform: "scale(1)" }], { duration: 160, easing: "ease-out" });
    d.lastMag = d.tgt.magnet;
    const wk = $("ag-week").getBoundingClientRect();                       // défilement automatique près des bords
    d.scroll = e.clientY < wk.top + 70 ? -1 : e.clientY > wk.bottom - 50 ? 1 : 0;
  }
  function resizeTo(e) {
    const d = drag, r = d.el.getBoundingClientRect();
    const raw = d.startMin + (e.clientY - r.top) / HH * 60;
    const sn = snapStart(d.el.closest(".ag-col").dataset.d, raw, 0, d.tid);
    let end = Math.round(raw / SNAP) * SNAP; if (sn.guide != null) end = sn.guide;
    end = Math.max(d.startMin + SNAP, Math.min(g.h1 * 60, end));
    d.newDur = end - d.startMin; d.el.style.height = Math.max(30, d.newDur / 60 * HH - 2) + "px";
    const sm = d.el.querySelector("small"); if (sm) sm.textContent = `${hm(d.startMin)}–${hm(end)} · ${d.newDur} min`;
    d.el.classList.toggle("mag", sn.guide != null);
  }
  function follow() {                                                         // le fantôme est « tiré » vers la cible : ressort plus fort quand l'aimant accroche
    const d = drag; if (!d || !d.ghost) return;
    let tx = d.px - d.grabX, ty = d.py - (d.mode === "task" ? 22 : d.grabY), k = 0.34;
    if (d.mode === "task") tx = d.px - 90;
    if (d.tgt && d.tgt.magnet) { const lr = d.land.getBoundingClientRect(); tx = lr.left; ty = lr.top; k = 0.5; }
    d.cur.x += (tx - d.cur.x) * k; d.cur.y += (ty - d.cur.y) * k;
    d.ghost.style.left = d.cur.x + "px"; d.ghost.style.top = d.cur.y + "px";
    d.ghost.style.transform = `rotate(${Math.max(-4, Math.min(4, (tx - d.cur.x) * 0.05))}deg) scale(${d.tgt && d.tgt.magnet ? 1.02 : 1.05})`;
    const sm = d.ghost.querySelector("small"); if (sm) sm.textContent = d.tgt ? `${hm(d.tgt.start)} · ${d.tgt.ds.slice(8)}/${d.tgt.ds.slice(5, 7)}` : d.mode === "task" ? "dépose sur la timeline" : "hors de la grille";
    if (d.scroll) $("ag-week").scrollTop += d.scroll * 9;
    d.raf = requestAnimationFrame(follow);
  }
  function cleanup() {
    const d = drag; if (!d) return;
    cancelAnimationFrame(d.raf); if (d.ghost) d.ghost.remove(); if (d.land) d.land.remove();
    d.el.classList.remove("lifted", "sizing", "mag"); document.body.classList.remove("ag-dragging");
    document.querySelectorAll("#ag-week .ag-guide").forEach((x) => x.remove());
    document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); document.removeEventListener("pointercancel", cancelDrag);
    drag = null;
  }
  function cancelDrag() { const d = drag; cleanup(); if (d && d.mode === "resize") render(); }
  async function onUp(e) {
    const d = drag; if (!d || e.pointerId !== d.id) return;
    const moved = d.on, tgt = d.tgt, col = d.col;
    if (d.mode === "resize") {
      const dur = d.newDur; cleanup();
      if (!moved || !dur) return render();
      const it = data.items.find((x) => x.task_id === d.tid); if (it) it.end = toLocal(new Date(new Date(it.start).getTime() + dur * 60000));
      render();
      try { await api("/api/agenda/tasks/" + d.tid, "PATCH", { duration_min: dur }); load(); } catch (x) { msg(x.message); load(); }
      return;
    }
    cleanup();
    if (!moved || !tgt) return;
    const due = `${tgt.ds}T${hm(tgt.start)}`;
    const t = tasksCache.find((x) => x.id === d.tid); if (t) t.due = due;
    const it = data.items.find((x) => x.task_id === d.tid);
    if (it) { const dur = d.dur; it.start = due; it.end = dur ? toLocal(new Date(new Date(due).getTime() + dur * 60000)) : due; }
    else if (t) { data.items.push({ id: "t-" + t.id, task_id: t.id, source: "manual", kind: "task", title: t.title, start: due, end: due, all_day: false, location: "", done: t.done }); }
    render(); renderTasks();
    const landed = document.querySelector(`#ag-week .ag-ev[data-task="${d.tid}"]`);
    if (landed) { landed.classList.add("landed"); const [x, y] = centerOf(landed); if (tgt.magnet) burst(x, y, col, false); }
    try { await api("/api/agenda/tasks/" + d.tid, "PATCH", { due }); load(); } catch (x) { msg(x.message); load(); }
  }
  const toLocal = (dt) => ymd(dt) + "T" + pad(dt.getHours()) + ":" + pad(dt.getMinutes());

  // ------------------------------------------------------------------ clavier : ↑/↓ déplace de 15 min, Maj+↑/↓ change la durée, Espace termine
  async function onKey(e) {
    const ev = e.target.closest && e.target.closest(".ag-ev.mv"); if (!ev || e.target !== ev) return;
    const tid = ev.dataset.task, it = data.items.find((x) => x.task_id === tid); if (!it) return;
    if (e.key === " ") { e.preventDefault(); return toggleDone(tid, !it.done, ev.querySelector("[data-ck]") || ev); }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const dir = e.key === "ArrowUp" ? -1 : 1, s = new Date(it.start), e0 = new Date(it.end || it.start), dur = Math.max(0, Math.round((e0 - s) / 60000));
    try {
      if (e.shiftKey) await api("/api/agenda/tasks/" + tid, "PATCH", { duration_min: Math.max(SNAP, (dur || 30) + dir * SNAP) });
      else await api("/api/agenda/tasks/" + tid, "PATCH", { due: toLocal(new Date(s.getTime() + dir * SNAP * 60000)) });
      await load(); const again2 = document.querySelector(`#ag-week .ag-ev[data-task="${tid}"]`); if (again2) again2.focus();
    } catch (x) { msg(x.message); }
  }

  // ------------------------------------------------------------------ chargement / cycle de vie
  async function load(refresh) {
    if (busy) { again = true; return; }
    busy = true;
    try {
      data = await api(`/api/agenda/overview?days=7&start=${ymd(weekStart)}${refresh ? "&refresh=true" : ""}`);
      await loadTasks();
      if (!drag) render();
    } catch (e) { msg(e.message); }
    busy = false;
    if (again) { again = false; load(); }
  }

  function open(focusCfg) {
    build();
    $("ag").hidden = false;
    if (window.enosOS) window.enosOS.closeLauncher();
    focus = new Date(); weekStart = mondayOf(focus);
    $("ag-week").dataset.scrolled = "";
    fxCanvas(); load();
    clearInterval(timer);
    let tick = 0;
    timer = setInterval(() => {                                               // chaque minute : la ligne « maintenant » et les couleurs d'urgence avancent ; toutes les 2 min, resynchronisation
      if ($("ag").hidden || drag) return;
      if (++tick % 2 === 0) load(); else { render(); renderTasks(); }
    }, 60000);
    if (focusCfg === true) setTimeout(() => $("ag-zeus").focus(), 300);
  }
  function close() { const s = $("ag"); if (s) s.hidden = true; clearInterval(timer); if (drag) cancelDrag(); }
  window.enosAgenda = { open, close };
})();
