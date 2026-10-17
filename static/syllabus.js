"use strict";
// SYLLABUS SCANNER : importe un plan de cours (PDF / Word / texte), l'IA en extrait examens, rendus et séances ; l'utilisateur vérifie, corrige, puis ajoute à l'agenda (import annulable).
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const TOKEN = () => (document.querySelector('meta[name="nasko-token"]') || {}).content || "";
  let toastT = 0, events = [], filter = "all", lastBatch = "";
  const KIND = { exam: "Examen", deadline: "À rendre", class: "Cours", task: "Tâche" };

  async function api(path, opts = {}) {
    const h = { "X-Nasko-Token": TOKEN() };
    let body = opts.body;
    if (body !== undefined && !(body instanceof FormData)) { h["Content-Type"] = "application/json"; body = JSON.stringify(body); }
    const r = await fetch(path, { method: opts.method || (body !== undefined ? "POST" : "GET"), headers: h, body });
    if (!r.ok) { let d = r.statusText; try { d = (await r.json()).detail || d; } catch (e) {} throw new Error(typeof d === "string" ? d : "requête refusée"); }
    return r.json();
  }
  function toast(m) { const t = $("sy-toast"); t.textContent = m; t.className = "sy-toast show"; clearTimeout(toastT); toastT = setTimeout(() => (t.className = "sy-toast"), 4000); }

  function build() {
    if ($("sy")) return;
    const s = document.createElement("section");
    s.id = "sy"; s.hidden = true; s.setAttribute("role", "dialog"); s.setAttribute("aria-label", "Syllabus Scanner");
    s.innerHTML = `<div class="sy-top"><h2>SYLLABUS SCANNER<small>Importez un plan de cours : E.N.O.S. remplit l'agenda pour vous</small></h2><button class="sy-b" id="sy-close">✕ FERMER</button></div>
      <div class="sy-main" id="sy-main"></div><div class="sy-toast" id="sy-toast" role="status"></div><input type="file" id="sy-file" hidden accept=".pdf,.docx,.txt,.md,.csv">`;
    document.body.appendChild(s);
    $("sy-close").onclick = close;
    $("sy-file").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) analyze(f); };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !s.hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) close(); });
  }

  function stepDrop(err) {
    $("sy-main").innerHTML = `${err ? `<div class="sy-warn err">${esc(err)}</div>` : ""}<div class="sy-dz" id="sy-dz"><b>DÉPOSEZ LE PLAN DE COURS ICI</b>
      <p>PDF, Word (.docx) ou texte : planning de l'école, syllabus d'un professeur, consignes de projet. E.N.O.S. repère les examens, les rendus et les séances, puis vous les montre avant de les ajouter à l'agenda.</p>
      <button class="sy-b pri big" type="button">CHOISIR UN FICHIER</button><p style="font-size:13px">Le texte du document est envoyé au LLM configuré pour être analysé ; le fichier n'est pas conservé.</p></div>`;
    const dz = $("sy-dz");
    dz.onclick = () => $("sy-file").click();
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
    dz.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) analyze(f); });
  }

  async function analyze(file) {
    $("sy-main").innerHTML = `<div class="sy-prog"><b>ANALYSE EN COURS</b><small id="sy-stage">${esc(file.name)}</small><div class="sy-bar"><i id="sy-bar"></i></div></div>`;
    try {
      const fd = new FormData(); fd.append("file", file, file.name);
      let j = await api("/api/syllabus/analyze", { body: fd });
      while (j.busy) { await wait(500); j = await api("/api/syllabus/job"); $("sy-stage").textContent = j.stage || ""; $("sy-bar").style.width = Math.max(3, j.progress) + "%"; }
      if (j.error) return stepDrop(j.error);
      events = j.result.events.map((e) => ({ ...e, on: !e.dup }));
      filter = "all"; stepReview(j.result.summary);
    } catch (e) { stepDrop(e.message); }
  }

  const plural = (n, a, b) => `${n} ${n > 1 ? b : a}`;
  function stepReview(sum) {
    const n = events.length;
    const bits = [];
    if (sum.exam) bits.push(`<b>${plural(sum.exam, "examen", "examens")}</b>`);
    if (sum.deadline) bits.push(`<b>${plural(sum.deadline, "travail à rendre", "travaux à rendre")}</b>`);
    if (sum.class) bits.push(`<b>${plural(sum.class, "séance de cours", "séances de cours")}</b>`);
    if (sum.task) bits.push(`<b>${plural(sum.task, "autre tâche", "autres tâches")}</b>`);
    const dup = events.filter((e) => e.dup).length;
    $("sy-main").innerHTML = `<div class="sy-sum"><p>E.N.O.S. a détecté ${bits.join(", ")} dans ce document. Voulez-vous les ajouter à l'agenda ?${dup ? ` <span style="color:var(--muted);font-size:15px">(${plural(dup, "est déjà dans l'agenda", "sont déjà dans l'agenda")} : décoché${dup > 1 ? "s" : ""}.)</span>` : ""}</p>
      <button class="sy-b pri big" id="sy-go"></button><button class="sy-b" id="sy-new">AUTRE DOCUMENT</button></div>
      <div class="sy-tools" id="sy-tools"></div><div id="sy-list"></div>`;
    $("sy-new").onclick = () => stepDrop();
    $("sy-go").onclick = doImport;
    drawTools(); drawList();
  }

  function drawTools() {
    const kinds = [["all", "TOUT"], ["exam", "EXAMENS"], ["deadline", "À RENDRE"], ["class", "COURS"], ["task", "AUTRES"]];
    $("sy-tools").innerHTML = kinds.map(([k, l]) => `<button class="sy-chip${filter === k ? " on" : ""}" data-k="${k}">${l}</button>`).join("") +
      `<span style="flex:1"></span><button class="sy-chip" id="sy-all">TOUT COCHER</button><button class="sy-chip" id="sy-none">TOUT DÉCOCHER</button>`;
    $("sy-tools").querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { filter = b.dataset.k; drawTools(); drawList(); }));
    $("sy-all").onclick = () => { events.forEach((e) => (e.on = true)); drawList(); };
    $("sy-none").onclick = () => { events.forEach((e) => (e.on = false)); drawList(); };
  }

  function counter() {
    const n = events.filter((e) => e.on).length;
    const b = $("sy-go"); if (b) { b.textContent = n ? `AJOUTER ${n} ÉLÉMENT${n > 1 ? "S" : ""} À L'AGENDA` : "RIEN DE COCHÉ"; b.disabled = !n; }
  }

  function drawList() {
    const rows = events.map((e, i) => [e, i]).filter(([e]) => filter === "all" || e.kind === filter);
    $("sy-list").innerHTML = `<table class="sy-tbl"><thead><tr><th></th><th>TYPE</th><th>INTITULÉ</th><th>DATE</th><th>HEURE</th><th>DURÉE (min)</th></tr></thead><tbody>` +
      rows.map(([e, i]) => `<tr class="${e.kind}${e.on ? "" : " off"}" data-i="${i}"><td><input type="checkbox" data-f="on" ${e.on ? "checked" : ""}></td>
        <td><select data-f="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${e.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
        <td><input type="text" data-f="title" value="${esc(e.title)}" maxlength="200" title="${esc(e.location ? "Lieu : " + e.location : "")}">${e.dup ? '<span class="sy-tag">DÉJÀ DANS L\'AGENDA</span>' : ""}</td>
        <td><input type="date" data-f="date" value="${esc(e.date)}"></td>
        <td><input type="time" data-f="time" value="${esc(e.time)}">${e.time_guess ? '<span class="sy-tag guess" title="Heure absente du document : valeur par défaut, à vérifier">ESTIMÉE</span>' : ""}</td>
        <td><input type="number" data-f="duration_min" min="0" max="1440" step="5" value="${e.duration_min || 0}"></td></tr>`).join("") + `</tbody></table>`;
    $("sy-list").querySelectorAll("tr[data-i]").forEach((tr) => {
      const e = events[+tr.dataset.i];
      tr.querySelectorAll("[data-f]").forEach((el) => {
        el.onchange = el.oninput = () => {
          const f = el.dataset.f; e[f] = f === "on" ? el.checked : f === "duration_min" ? Math.max(0, +el.value || 0) : el.value;
          if (f === "time") e.time_guess = false;
          if (f === "on") { tr.classList.toggle("off", !e.on); counter(); }
          if (f === "kind") tr.className = e.kind + (e.on ? "" : " off");
        };
      });
    });
    counter();
  }

  async function doImport() {
    const chosen = events.filter((e) => e.on);
    if (!chosen.length) return;
    const bad = chosen.find((e) => !e.date || !e.time || !String(e.title).trim());
    if (bad) return toast("Complétez la date, l'heure et l'intitulé de chaque élément coché.");
    $("sy-go").disabled = true;
    try {
      const r = await api("/api/syllabus/import", { body: { events: chosen.map(({ title, kind, date, time, duration_min, location, notes }) => ({ title, kind, date, time, duration_min, location, notes })) } });
      lastBatch = r.batch; stepDone(r);
    } catch (e) { toast(e.message); $("sy-go").disabled = false; }
  }

  function stepDone(r) {
    $("sy-main").innerHTML = `<div class="sy-done"><div class="tick">✓</div><h3>${plural(r.added, "ÉLÉMENT AJOUTÉ", "ÉLÉMENTS AJOUTÉS")}</h3>
      <p>${r.skipped ? `${plural(r.skipped, "doublon ignoré", "doublons ignorés")}. ` : ""}Ils apparaissent dans l'agenda et l'IA vous préviendra avant chaque échéance.</p>
      <div class="acts"><button class="sy-b pri big" id="sy-see">VOIR L'AGENDA</button><button class="sy-b" id="sy-undo">ANNULER L'IMPORT</button><button class="sy-b" id="sy-again">IMPORTER UN AUTRE DOCUMENT</button></div></div>`;
    $("sy-see").onclick = () => { close(); if (window.enosAgenda) window.enosAgenda.open(); };
    $("sy-again").onclick = () => stepDrop();
    $("sy-undo").onclick = async () => {
      try { const u = await api("/api/syllabus/undo", { body: { batch: lastBatch } }); toast(`Import annulé : ${plural(u.removed, "élément retiré", "éléments retirés")}.`); stepDrop(); } catch (e) { toast(e.message); }
    };
  }

  function open() { build(); $("sy").hidden = false; if (window.enosOS && window.enosOS.closeLauncher) window.enosOS.closeLauncher(); stepDrop(); }
  function close() { const s = $("sy"); if (s) s.hidden = true; }
  window.enosSyllabus = { open, close };
  document.addEventListener("DOMContentLoaded", () => { const b = $("b-syl"); if (b) b.onclick = open; });
  if (document.readyState !== "loading") { const b = $("b-syl"); if (b) b.onclick = open; }
})();
