"use strict";
// MODULES NATIFS DU TÉLÉPHONE : Agenda, Contrôle API, Nettoyeur de stockage, Œil (E.N.O.S. rouge / ETO pixel-art). Ils fonctionnent SANS le PC.
(() => {
  const E = window.ENOS, $ = E.$, esc = E.esc, pad = E.pad, N = E.native, U = E.ui, G = E.agenda, A = E.ai;
  const mk = (id, html) => {
    const sv = document.createElement("div");
    sv.id = "tool-" + id; sv.className = "subview"; sv.hidden = true; sv.innerHTML = html;
    $(".view[data-v=tools] .scroll").insertBefore(sv, $(".view[data-v=tools] .foot-pad"));
    return sv;
  };
  const back = '<button class="back" data-back>◂ MODULES</button>';
  const DOWS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"], MONS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const localISO = (d) => `${E.ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  // ================================================================== AGENDA
  function agendaInit() {
    mk("agenda", `${back}<div class="card"><h3>Agenda<button class="mini" id="ag-add">+ TÂCHE</button></h3><div id="ag-sync" class="muted" style="font-size:13px;margin-bottom:8px"></div><div id="ag-list"></div></div>
      <div class="card" id="ag-undated-card" hidden><h3>Sans date</h3><div class="list" id="ag-undated"></div></div>`);
    $("#ag-add").onclick = async () => {
      const title = await U.prompt("Nouvelle tâche", "Ex. Rendre le TP de C", "", "SUIVANT");
      if (!title || !title.trim()) return;
      const due = await U.prompt("Échéance (facultatif)", "AAAA-MM-JJ HH:MM", "", "AJOUTER");
      const m = (due || "").trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
      G.addTask(title, m ? `${m[1]}T${pad(+(m[2] || 9))}:${m[3] || "00"}` : "");
      U.toast("Tâche ajoutée", "ok");
    };
    $("#ag-list").addEventListener("click", (e) => { const t = e.target.closest("[data-task]"); if (t) { G.toggleTask(t.dataset.task); E.vibrate(10); } });
    $("#ag-undated").addEventListener("click", (e) => { const t = e.target.closest("[data-task]"); if (t) { G.toggleTask(t.dataset.task); E.vibrate(10); } });
    [$("#ag-list"), $("#ag-undated")].forEach((c) => U.longPress(c, "[data-task]", (el) => U.sheet({ title: "Tâche", options: [{ label: "Supprimer", cls: "bad", fn: () => G.deleteTask(el.dataset.task) }] })));
    E.on("agenda", agendaPaint); E.on("link", agendaPaint);
  }
  function agendaPaint() {
    if (!$("#ag-list")) return;
    const now = new Date(), items = G.items(E.ymd(now) + "T00:00", E.ymd(new Date(now.getTime() + 14 * 864e5)) + "T00:00");
    const byDay = {};
    items.forEach((i) => (byDay[i.start.slice(0, 10)] = byDay[i.start.slice(0, 10)] || []).push(i));
    const days = Object.keys(byDay).sort();
    $("#ag-list").innerHTML = days.length ? days.map((d) => {
      const dt = new Date(d + "T12:00");
      return `<div class="ag-day"><h4>${DOWS[dt.getDay()]} ${dt.getDate()} ${MONS[dt.getMonth()]}${d === E.ymd(now) ? " · aujourd'hui" : ""}</h4><div class="list">${byDay[d].map((i) =>
        `<div class="it ${i.source}${i.done ? " done" : ""}" ${i.kind === "task" ? `data-task="${esc(i.id)}"` : ""}>${i.kind === "task" ? '<span class="chk"></span>' : '<span class="dot"></span>'}<span class="tm">${i.start.slice(11, 16)}</span><span class="n">${esc(i.title)}${i.location ? `<small>${esc(i.location)}</small>` : ""}</span>${i.kind === "exam" ? '<span class="tag hot">CONTRÔLE</span>' : i.kind === "deadline" ? '<span class="tag warm">RENDU</span>' : ""}</div>`).join("")}</div></div>`;
    }).join("") : '<div class="empty">Rien dans les 14 prochains jours. Ajoute tes liens Zeus / Moodle dans Réglages, ou crée une tâche.</div>';
    const und = G.liveTasks().filter((t) => !t.due);
    $("#ag-undated-card").hidden = !und.length;
    $("#ag-undated").innerHTML = und.map((t) => `<div class="it manual${t.done ? " done" : ""}" data-task="${esc(t.id)}"><span class="chk"></span><span class="n">${esc(t.title)}</span></div>`).join("");
    $("#ag-sync").textContent = E.link.state === "online" ? "Synchronisé avec l'agenda du PC" : "Hors ligne : tes tâches se synchroniseront au retour du PC";
  }

  // ================================================================== CONTRÔLE API
  const dayKey = () => E.ymd(new Date());
  E.usage = {
    add(tokens) { const k = "usage." + dayKey(), u = E.store.get(k, { req: 0, tokens: 0 }); u.req += 1; u.tokens += tokens || 0; E.store.set(k, u); },
    today() { return E.store.get("usage." + dayKey(), { req: 0, tokens: 0 }); },
    week() { let r = 0, t = 0; for (let i = 0; i < 7; i++) { const u = E.store.get("usage." + E.ymd(new Date(Date.now() - i * 864e5)), { req: 0, tokens: 0 }); r += u.req; t += u.tokens; } return { req: r, tokens: t }; },
  };
  function apiInit() {
    mk("api", `${back}<div id="api-cards"></div><button class="btn wide" id="api-refresh">ACTUALISER LES QUOTAS</button>`);
    $("#api-refresh").onclick = apiPaint;
  }
  async function elevenCard(provider, label) {
    if (!N.vault.has(provider)) return `<div class="card"><h3>${label}</h3><div class="empty">Clé absente : Réglages › Clés d'API.</div></div>`;
    try {
      const r = await N.fetch({ provider, path: "/v1/user/subscription", method: "GET" });
      if (r.status === 401) return `<div class="card"><h3>${label}</h3><div class="empty">Clé refusée par ElevenLabs (invalide ou révoquée).</div></div>`;
      const j = r.json() || {}, used = j.character_count || 0, lim = j.character_limit || 0, pct = lim ? Math.round(used / lim * 100) : 0;
      const reset = j.next_character_count_reset_unix ? new Date(j.next_character_count_reset_unix * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "—";
      return `<div class="card"><h3>${label}<span class="sp">${esc(j.tier || "")}</span></h3><div class="bar-row" style="margin-top:0"><div class="t"><span>Caractères utilisés</span><b>${used.toLocaleString("fr-FR")} / ${lim.toLocaleString("fr-FR")}</b></div><div class="b"><i style="--v:${pct}%"></i></div></div><div class="muted" style="margin-top:8px;font-size:13.5px">${pct} % consommés · remise à zéro le ${reset}</div></div>`;
    } catch (e) { return `<div class="card"><h3>${label}</h3><div class="empty">Quota indisponible (${esc(e.message)}).</div></div>`; }
  }
  async function apiPaint() {
    const box = $("#api-cards");
    box.innerHTML = '<div class="card"><div class="muted">Lecture des quotas…</div></div>';
    const t = E.usage.today(), w = E.usage.week();
    const groq = `<div class="card"><h3>Groq · ${esc(A.model())}</h3>${N.vault.has("groq") ? `<div class="grid2" style="gap:10px"><div class="mstat"><small>AUJOURD'HUI</small><b>${t.req}</b><span>requêtes</span></div><div class="mstat"><small>TOKENS</small><b>${t.tokens.toLocaleString("fr-FR")}</b><span>aujourd'hui</span></div></div><div class="muted" style="margin-top:10px;font-size:13.5px">7 jours : ${w.req} requêtes · ${w.tokens.toLocaleString("fr-FR")} tokens (compteurs de CE téléphone ; Groq ne publie pas de quota consultable).</div>` : '<div class="empty">Clé absente : Réglages › Clés d\'API.</div>'}</div>`;
    const [a, b] = await Promise.all([elevenCard("eleven_enos", "ElevenLabs · E.N.O.S."), elevenCard("eleven_eto", "ElevenLabs · ETO")]);
    box.innerHTML = groq + a + b;
  }

  // ================================================================== NETTOYEUR DE STOCKAGE
  const CAT = { Images: "jpg jpeg png webp gif heic bmp", Vidéos: "mp4 mkv mov avi webm 3gp", Audio: "mp3 wav flac ogg m4a aac opus", Documents: "pdf doc docx txt rtf odt ppt pptx xls xlsx csv md epub", Archives: "zip rar 7z tar gz", Applications: "apk" };
  const catOf = (n) => { const e = (n.split(".").pop() || "").toLowerCase(); return Object.keys(CAT).find((c) => CAT[c].split(" ").includes(e)) || "Autres"; };
  const CL = { files: [], tree: null, total: 0 };
  function cleanInit() {
    mk("clean", `${back}<div class="card"><h3>Stockage du téléphone</h3><div id="cl-store"></div></div>
      <div class="card"><h3>Analyse d'un dossier<button class="mini" id="cl-pick">CHOISIR</button></h3><div class="muted" id="cl-info" style="font-size:14px">Choisis un dossier (Téléchargements, DCIM, Documents…) : les plus gros fichiers et les doublons probables apparaissent.</div><div id="cl-cats"></div></div>
      <div class="card" id="cl-res" hidden><h3>Plus gros fichiers<span class="sp" id="cl-sel"></span></h3><div class="list" id="cl-list"></div><div class="row"><button class="btn warn" id="cl-del" disabled>SUPPRIMER LA SÉLECTION</button></div></div>
      <div class="card" id="cl-dup" hidden><h3>Doublons probables</h3><div class="list" id="cl-duplist"></div></div>`);
    $("#cl-pick").onclick = async () => { const r = await N.files.pickTree(); if (r && r.uri) scan(r); else if (r && r.error) U.toast(r.error, "warn"); };
    $("#cl-list").addEventListener("click", (e) => { const it = e.target.closest("[data-i]"); if (!it) return; const f = CL.files[+it.dataset.i]; f.sel = !f.sel; it.classList.toggle("done", f.sel); selUpd(); E.vibrate(6); });
    $("#cl-del").onclick = delSel;
  }
  function cleanEnter() {
    let s = null;
    try { s = JSON.parse(N.available ? window.Enos.storage() : "null"); } catch (e) { /* pas de pont */ }
    $("#cl-store").innerHTML = s && s.total ? `<div class="bar-row" style="margin-top:0"><div class="t"><span>Utilisé</span><b>${E.bytes(s.total - s.free)} / ${E.bytes(s.total)}</b></div><div class="b"><i style="--v:${Math.round((s.total - s.free) / s.total * 100)}%"></i></div></div><div class="muted" style="margin-top:8px;font-size:13.5px">${E.bytes(s.free)} libres</div>` : '<div class="empty">Disponible dans l\'application Android.</div>';
    const saved = E.settings.get("tree", null);
    if (saved && !CL.tree) $("#cl-info").innerHTML = `Dernier dossier : <b>${esc(saved.name)}</b> — touche CHOISIR pour (re)lancer l'analyse.`;
  }
  async function scan(tree) {
    CL.tree = tree; CL.files = []; let n = 0;
    E.settings.set("tree", tree);
    $("#cl-info").textContent = "Analyse en cours…"; $("#cl-res").hidden = $("#cl-dup").hidden = true;
    const walk = async (docId, path, depth) => {
      if (depth > 6 || n > 6000) return;
      const items = N.files.list(tree.uri, docId);
      for (const it of items) {
        if (++n > 6000) return;
        if (it.dir) { await walk(it.id, path + it.name + "/", depth + 1); if (n % 80 === 0) await E.sleep(0); }
        else CL.files.push({ id: it.id, name: it.name, path, size: it.size, mtime: it.mtime, cat: catOf(it.name), sel: false });
      }
    };
    await walk("", "", 0);
    const total = CL.files.reduce((a, f) => a + f.size, 0), byCat = {};
    CL.files.forEach((f) => (byCat[f.cat] = (byCat[f.cat] || 0) + f.size));
    $("#cl-info").innerHTML = `<b>${esc(tree.name)}</b> : ${CL.files.length} fichiers · ${E.bytes(total)}${n > 6000 ? " (analyse limitée aux 6 000 premiers éléments)" : ""}`;
    $("#cl-cats").innerHTML = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, s]) => `<div class="bar-row"><div class="t"><span>${c}</span><b>${E.bytes(s)}</b></div><div class="b"><i style="--v:${total ? Math.round(s / total * 100) : 0}%"></i></div></div>`).join("");
    CL.files.sort((a, b) => b.size - a.size);
    const top = CL.files.slice(0, 40);
    $("#cl-res").hidden = !top.length;
    $("#cl-list").innerHTML = top.map((f, i) => `<div class="it f-it" data-i="${CL.files.indexOf(f)}"><span class="chk"></span><span class="n">${esc(f.name)}<small>${esc(f.path || "/")} · ${f.mtime ? new Date(f.mtime).toLocaleDateString("fr-FR") : ""}</small></span><span class="tag ${f.size > 100e6 ? "hot" : f.size > 20e6 ? "warm" : ""}">${E.bytes(f.size)}</span></div>`).join("");
    const groups = {};
    CL.files.filter((f) => f.size > 1e6).forEach((f) => (groups[f.name + "|" + f.size] = groups[f.name + "|" + f.size] || []).push(f));
    const dups = Object.values(groups).filter((g) => g.length > 1).slice(0, 15);
    $("#cl-dup").hidden = !dups.length;
    $("#cl-duplist").innerHTML = dups.map((g) => `<div class="it"><span class="n">${esc(g[0].name)}<small>${g.length} copies · ${E.bytes(g[0].size)} chacune : ${g.map((f) => esc(f.path || "/")).join(" · ")}</small></span></div>`).join("");
    selUpd();
  }
  function selUpd() { const s = CL.files.filter((f) => f.sel); $("#cl-sel").textContent = s.length ? `${s.length} · ${E.bytes(s.reduce((a, f) => a + f.size, 0))}` : ""; $("#cl-del").disabled = !s.length; }
  async function delSel() {
    const s = CL.files.filter((f) => f.sel), size = s.reduce((a, f) => a + f.size, 0);
    if (!s.length || !(await U.confirm("Supprimer définitivement ?", `${s.length} fichier(s), ${E.bytes(size)}. Android n'a pas de corbeille : c'est irréversible.`, "SUPPRIMER", true))) return;
    let ok = 0, freed = 0;
    for (const f of s) { const r = N.files.op("delete", { tree: CL.tree.uri, doc: f.id }); if (r.ok) { ok++; freed += f.size; } }
    U.toast(`${ok}/${s.length} supprimé(s) · ${E.bytes(freed)} libérés`, ok === s.length ? "ok" : "warn", 5000);
    scan(CL.tree);
  }

  // ================================================================== ŒIL (E.N.O.S. / ETO)
  const EYE = { persona: "enos", face: null, busy: false, speaking: false, thinking: false, raf: 0, look: { x: 0, y: 0 } };
  function eyeInit() {
    mk("eye", `${back}<div class="card eye-card"><div class="seg" id="eye-seg" data-p="enos"><button data-p="enos" class="on">E.N.O.S.</button><button data-p="eto">ETO</button><i class="seg-ind"></i></div>
      <div class="eye-stage" id="eye-stage"><canvas id="eye-enos" width="240" height="240"></canvas><div id="eye-eto" hidden></div></div>
      <div class="eye-sub" id="eye-sub">Touche l'écran : il te suit des yeux.</div>
      <div class="composer eye-comp"><textarea id="eye-inp" rows="1" placeholder="Parle-lui…" enterkeyhint="send"></textarea><button class="send" id="eye-send" aria-label="Envoyer"><svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg></button></div></div>`);
    const seg = $("#eye-seg");
    seg.querySelectorAll("button").forEach((b) => (b.onclick = () => eyePersona(b.dataset.p)));
    $("#eye-send").onclick = eyeSend;
    $("#eye-inp").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); eyeSend(); } };
    const stage = $("#eye-stage");
    const mv = (e) => { const t = e.touches ? e.touches[0] : e, r = stage.getBoundingClientRect(); EYE.look = { x: Math.max(-1, Math.min(1, (t.clientX - r.left - r.width / 2) / (r.width / 2))), y: Math.max(-1, Math.min(1, (t.clientY - r.top - r.height / 2) / (r.height / 2))) }; if (EYE.face) EYE.face.look(EYE.look.x, EYE.look.y); };
    stage.addEventListener("touchmove", mv, { passive: true }); stage.addEventListener("touchstart", mv, { passive: true });
    E.on("speak", (on) => { EYE.speaking = !!on; if (EYE.face) EYE.face.speaking(!!on); });
  }
  function eyePersona(p) {
    EYE.persona = p;
    $("#eye-seg").dataset.p = p;
    $("#eye-seg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.p === p));
    $("#eye-enos").hidden = p !== "enos"; $("#eye-eto").hidden = p !== "eto";
    if (p === "eto" && !EYE.face && window.EtoFace) EYE.face = window.EtoFace.mount($("#eye-eto"), { expression: "smile", follow: false });
    $("#eye-sub").textContent = p === "eto" ? "ETO t'écoute." : "E.N.O.S. est en ligne.";
  }
  async function eyeSend() {
    const inp = $("#eye-inp"), text = inp.value.trim();
    if (!text || EYE.busy) return;
    if (!A.configured()) return U.toast("Ajoute ta clé Groq dans Réglages.", "warn");
    EYE.busy = true; inp.value = ""; EYE.thinking = true;
    if (EYE.face) EYE.face.set("thinking");
    $("#eye-sub").textContent = "…";
    A.stopVoice();
    try {
      const reply = await A.chat(EYE.persona, text, (p) => { $("#eye-sub").textContent = p; });
      EYE.thinking = false;
      $("#eye-sub").textContent = reply;
      if (EYE.face && window.EtoFace) { const g = window.EtoFace.guess ? window.EtoFace.guess(reply) : null; EYE.face.set("smile"); if (g) EYE.face.react(g, 2200); }
      if (A.voiceOn()) A.speak(EYE.persona, reply);
    } catch (e) { EYE.thinking = false; $("#eye-sub").textContent = e.message; if (EYE.face) EYE.face.set("awkward"); }
    EYE.busy = false;
  }
  // œil rouge d'E.N.O.S. (canvas) : iris qui respire, pupille qui suit le doigt, clignements, halo quand il parle
  function drawEnos() {
    const cv = $("#eye-enos");
    if (!cv || cv.hidden || !cv.offsetParent) { EYE.raf = requestAnimationFrame(drawEnos); return; }
    const c = cv.getContext("2d"), W = cv.width, t = performance.now() / 1000, cx = W / 2, cy = W / 2;
    c.clearRect(0, 0, W, W);
    const glow = EYE.speaking ? 0.55 + 0.35 * Math.sin(t * 12) : EYE.thinking ? 0.35 + 0.2 * Math.sin(t * 5) : 0.25 + 0.08 * Math.sin(t * 1.6);
    const hue = (E.settings.get("hue", 352));
    const g0 = c.createRadialGradient(cx, cy, 20, cx, cy, W / 2); g0.addColorStop(0, `hsla(${hue},90%,50%,${glow})`); g0.addColorStop(1, "transparent"); c.fillStyle = g0; c.fillRect(0, 0, W, W);
    const blink = (t % 4.3) < 0.14 ? Math.abs(Math.sin((t % 4.3) / 0.14 * Math.PI)) : 0, open = 1 - blink * 0.93;
    c.save(); c.beginPath(); c.ellipse(cx, cy, 104, 66 * open + 2, 0, 0, Math.PI * 2); c.clip();
    c.fillStyle = "#0c0708"; c.fillRect(0, 0, W, W);
    const scan = EYE.thinking ? Math.sin(t * 3) * 0.7 : 0, lx = (EYE.look.x + scan) * 26, ly = EYE.look.y * 14;
    const ir = c.createRadialGradient(cx + lx, cy + ly, 6, cx + lx, cy + ly, 56 + (EYE.speaking ? 4 * Math.sin(t * 14) : 0));
    ir.addColorStop(0, `hsl(${hue},95%,62%)`); ir.addColorStop(0.55, `hsl(${hue},90%,38%)`); ir.addColorStop(1, `hsl(${hue},80%,12%)`);
    c.fillStyle = ir; c.beginPath(); c.arc(cx + lx, cy + ly, 56, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#050203"; c.beginPath(); c.ellipse(cx + lx * 1.2, cy + ly * 1.2, 11 + (EYE.speaking ? 3 : 0), 40, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,255,255,.7)"; c.beginPath(); c.arc(cx + lx - 18, cy + ly - 20, 6, 0, Math.PI * 2); c.fill();
    c.restore();
    c.strokeStyle = `hsl(${hue},80%,35%)`; c.lineWidth = 3; c.beginPath(); c.ellipse(cx, cy, 104, 66 * open + 2, 0, 0, Math.PI * 2); c.stroke();
    EYE.raf = requestAnimationFrame(drawEnos);
  }

  E.apps = {
    init() { agendaInit(); apiInit(); cleanInit(); eyeInit(); drawEnos(); },
    enter(id) { if (id === "agenda") agendaPaint(); else if (id === "api") apiPaint(); else if (id === "clean") cleanEnter(); else if (id === "eye") eyePersona(E.settings.get("persona", "enos")); },
  };
})();
