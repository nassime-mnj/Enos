"use strict";
// TRAITEMENT D'IMAGE : panneau, galerie de tuiles, colis, livraison, ecrans de chargement plein ecran.
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { "X-Nasko-Token": TOKEN, "Content-Type": "application/json" } });
    if (!r.ok) {
      let d = r.statusText;
      try { d = (await r.json()).detail || d; } catch (e) {}
      throw new Error(d);
    }
    return r.json();
  }
  const post = (p, body) => api(p, { method: "POST", body: JSON.stringify(body || {}) });

  let cat = "simple", task = null, taskList = [], items = [], sel = new Set(), tsel = new Set(), cleanArm = 0, lastSt = null, delivering = false, convArm = 0;
  const NAMES = { simple: "IMAGE SIMPLE", multiple: "IMAGE MULTIPLE" };

  // ---------------------------------------------------------------- ecran de chargement plein ecran
  let shown = 0, target = 0, barTimer = null;
  function overlayOn(kind, title, sub) {
    const ov = $("ip-ov");
    ov.dataset.kind = kind;
    $("ip-ov-title").textContent = title;
    $("ip-ov-sub").textContent = sub || "";
    if (ov.hidden) { shown = 0; target = 0; ov.hidden = false; }
    if (!barTimer) barTimer = setInterval(tickBar, 100);
  }
  function overlayOff() {
    $("ip-ov").hidden = true;
    clearInterval(barTimer); barTimer = null;
  }
  function tickBar() {
    // la barre rattrape la progression reelle, et rampe doucement entre deux etapes pour rester « vivante »
    const ceil = Math.min(target + 7, 99);
    shown += shown < target ? (target - shown) * 0.12 + 0.05 : shown < ceil ? 0.04 : 0;
    $("ip-ov-fill").style.width = Math.min(shown, 100).toFixed(1) + "%";
    $("ip-ov-pct").textContent = Math.floor(Math.min(shown, 100)) + " %";
  }

  // ---------------------------------------------------------------- suivi du traitement (surveillance serveur)
  async function poll() {
    if (document.body.classList.contains("remote")) return;       // routes réservées au PC
    try {
      const st = await api("/api/imgproc/state");
      const wasBusy = lastSt && lastSt.busy;
      lastSt = st;
      hud(st);                                                      // bandeau non bloquant : on peut lancer / suivre plusieurs images à la fois
      if (st.busy) {
        target = st.progress;
      } else if (!delivering && !window.nasko_ov_lock && !(st.queue && st.queue.active)) {            // en lot : l'écran de suivi remplace les toasts image par image. nasko_ov_lock : un autre module (compression) pilote l'écran
        if (wasBusy) { target = 100; shown = 100; tickBar(); await wait(500); }
        overlayOff();
        if (wasBusy) { if (!panelOpen()) openPanel(); if (!st.error) toast("Traitement terminé — tuiles prêtes dans Livraison"); }
        if (wasBusy && !st.error && st.redirect) { goTask(st.redirect.cat, st.redirect.task); toast(`Découpage terminé — ${st.redirect.task} (Image Multiple)`); }
      }
      renderStatus(st);
      if (wasBusy && !st.busy && panelOpen() && !(st.redirect && !st.error)) loadView();
      renderQueue(st.queue);
      if (st.batch && !st.busy && !(st.queue && st.queue.active) && !batchAsking && !delivering && !window.nasko_ov_lock) handleBatch(st.batch);   // lot de dossier terminé : Oui / Non
    } catch (e) { /* serveur occupe : on reessaie */ }
  }

  function hud(st) {
    const el = $("ip-hud"), jobs = st.jobs || [];
    el.hidden = jobs.length === 0;
    el.innerHTML = jobs.map((j) => `<div class="ip-job"><b>${esc(j.name)}</b><span>${esc(j.stage)} · ${Math.round(j.progress)} %</span><i><u style="width:${Math.min(100, Math.round(j.progress))}%"></u></i></div>`).join("");
  }

  // ---------------------------------------------------------------- raccourci Téléchargements : sélection multiple -> « A faire »
  const dl = { items: [], sel: new Set() };
  async function openDownloads() {
    $("ip-dl").hidden = false; dl.sel.clear(); $("ip-dl-go").disabled = true;
    $("ip-dl-grid").innerHTML = '<div class="dim">Lecture du dossier…</div>';
    try {
      const r = await api("/api/imgproc/downloads"); dl.items = r.items;
      $("ip-dl-sub").textContent = (r.folder || "Dossier introuvable") + " · cochez plusieurs images : elles sont traitées une par une";
      $("ip-dl-grid").innerHTML = r.items.length ? r.items.map((i) => `<div class="ip-dlt" data-n="${esc(i.name)}"><img alt="" src="${i.thumb}"><small>${esc(i.name)}</small></div>`).join("") : '<div class="dim">Aucune image récente dans Téléchargements.</div>';
    } catch (e) { $("ip-dl-grid").innerHTML = `<div class="dim">${esc(e.message)}</div>`; }
  }
  function initDownloads() {
    $("ip-dlbtn").onclick = openDownloads;
    $("ip-dl-x").onclick = () => ($("ip-dl").hidden = true);
    $("ip-dl-folder").onclick = () => post("/api/imgproc/open-downloads").catch((e) => toast(e.message, true));
    $("ip-dl-grid").addEventListener("click", (e) => {
      const t = e.target.closest(".ip-dlt"); if (!t) return;
      dl.sel.has(t.dataset.n) ? dl.sel.delete(t.dataset.n) : dl.sel.add(t.dataset.n);
      t.classList.toggle("on", dl.sel.has(t.dataset.n)); $("ip-dl-go").disabled = dl.sel.size === 0;
      $("ip-dl-go").textContent = dl.sel.size ? `ENVOYER ${dl.sel.size} IMAGE${dl.sel.size > 1 ? "S" : ""} AU TRAITEMENT` : "ENVOYER AU TRAITEMENT";
    });
    $("ip-dl-go").onclick = async () => {
      try { const r = await post("/api/imgproc/import", { cat, names: [...dl.sel] }); $("ip-dl").hidden = true; toast(`${r.count} image(s) envoyée(s) dans « A faire » : traitement en cours (traitées une par une)`); poll(); }
      catch (e) { toast(e.message, true); }
    };
  }

  function renderStatus(st) {
    if (!$("ip").hidden) {
      $("ip-todo").textContent = `${st.todo_all[cat]} image(s) dans « A faire »`;
      $("ip-err").hidden = !st.error;
      $("ip-err-msg").textContent = st.error || "";
      $("ip-log").textContent = st.log.slice(-6).join("\n");
    }
  }

  // ---------------------------------------------------------------- panneau
  const panelOpen = () => !$("ip").hidden;
  function openPanel() { $("ip").hidden = false; document.body.classList.add("ip-open"); loadView(); if (lastSt) renderStatus(lastSt); }
  function closePanel() { $("ip").hidden = true; document.body.classList.remove("ip-open"); }

  // vue « liste des tâches » (task === null) ou vue « galerie d'une tâche »
  async function loadView() {
    if (task === null) {
      try { taskList = (await api("/api/imgproc/tasks?cat=" + cat)).items; } catch (e) { taskList = []; }
      items = []; sel.clear();
      const tn = new Set(taskList.map((t) => t.name));
      tsel = new Set([...tsel].filter((n) => tn.has(n)));                   // tâches disparues : retirées de la sélection
      renderTasks();
    } else {
      try { items = (await api(`/api/imgproc/files?cat=${cat}&task=${encodeURIComponent(task)}`)).items; }
      catch (e) { task = null; return loadView(); }          // tâche supprimée entre-temps
      const names = new Set(items.map((i) => i.name));
      sel = new Set([...sel].filter((n) => names.has(n)));
      renderGrid();
    }
  }

  function showMode() {
    const inTask = task !== null;
    $("ip-tasks").hidden = inTask;
    $("ip-grid").hidden = !inTask;
    $("ip-back").hidden = !inTask;
    $("ip-all").hidden = false;                                 // sélection multiple : dans la liste des tâches (colis de plusieurs tâches) comme dans une tâche
    $("ip-zip").hidden = false;
    $("ip-conv").hidden = !(inTask && cat === "simple");        // correction « planche déposée dans Image Simple »
    $("ip-crumb").textContent = inTask ? `${NAMES[cat]}  ▸  ${task.toUpperCase()}` : `${NAMES[cat]}  ▸  TÂCHES`;
  }

  function renderTasks() {
    const box = $("ip-tasks");
    box.innerHTML = "";
    $("ip-empty").hidden = taskList.length > 0;
    $("ip-empty").textContent = "— Aucune tâche : déposez une image dans « A faire » —";
    for (const t of taskList) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "ip-task" + (tsel.has(t.name) ? " on" : "");
      b.title = "Cliquer pour ouvrir · case ✔ pour sélectionner";
      b.innerHTML = `<span class="chk" title="Sélectionner cette tâche">✔</span><span class="tn">[ ${esc(t.name.toUpperCase())} ]</span><span class="tp">${t.previews.map((u) => `<img alt="" src="${u}">`).join("")}</span>` +
        `<small>${t.count} fichier${t.count > 1 ? "s" : ""}</small>`;
      b.onclick = (e) => {
        if (e.target.closest(".chk")) { tsel.has(t.name) ? tsel.delete(t.name) : tsel.add(t.name); b.classList.toggle("on"); updBar(); return; }
        task = t.name; sel.clear(); loadView();
      };
      box.appendChild(b);
    }
    showMode(); updBar();
  }

  function renderGrid() {
    const g = $("ip-grid");
    g.innerHTML = "";
    $("ip-empty").hidden = items.length > 0;
    $("ip-empty").textContent = "— Cette tâche est vide —";
    for (const it of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ip-tile" + (sel.has(it.name) ? " on" : "");
      b.title = it.name;
      b.innerHTML = `<span class="chk">✔</span><img alt="" draggable="false" src="${it.thumb}"><small>${esc(it.name)}</small>`;
      b.onclick = () => { sel.has(it.name) ? sel.delete(it.name) : sel.add(it.name); b.classList.toggle("on"); updBar(); };
      g.appendChild(b);
    }
    showMode(); updBar();
  }

  function updBar() {
    const inList = task === null, n = inList ? tsel.size : sel.size, tot = inList ? taskList.length : items.length;
    $("ip-count").textContent = inList ? `${tsel.size} / ${taskList.length} tâche(s) sélectionnée(s)` : `${sel.size} / ${items.length} sélectionnée(s)`;
    $("ip-zip").disabled = n === 0;
    $("ip-zip").textContent = inList && n ? `Créer un colis (${n} tâche${n > 1 ? "s" : ""})` : "Créer un colis (.zip)";
    $("ip-all").disabled = tot === 0;
    $("ip-all").textContent = n === tot && tot ? "TOUT DÉSÉLECTIONNER" : "TOUT SÉLECTIONNER";
    $("ip-clean").disabled = taskList.length === 0 && items.length === 0;
    clearTimeout(convArm); $("ip-conv").classList.remove("armed"); $("ip-conv").textContent = "Découper en tuiles (Erreur de dossier)";
    clearTimeout(cleanArm); $("ip-clean").classList.remove("armed"); $("ip-clean").textContent = "Nettoyer le dossier Livraison";
  }

  let toastT;
  function toast(msg, bad) {
    const t = $("ip-toast");
    t.textContent = msg; t.className = "ip-toast show" + (bad ? " bad" : "");
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = "ip-toast"), 4500);
  }

  function goTask(c, t) {                                   // saute directement dans la tâche d'une catégorie
    cat = c; task = t; sel.clear(); tsel.clear();
    document.querySelectorAll("#ip-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.c === c));
    loadView(); if (lastSt) renderStatus(lastSt);
  }

  function setCat(c) {
    cat = c; task = null; sel.clear(); tsel.clear();
    document.querySelectorAll("#ip-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.c === c));
    loadView(); if (lastSt) renderStatus(lastSt);
  }

  // ---------------------------------------------------------------- boite de dialogue (choix colis / destination)
  function dialog(title, rows, { note, cancel = "ANNULER" } = {}) {
    return new Promise((resolve) => {
      const d = $("ip-dlg"), list = $("ip-dlg-list");
      $("ip-dlg-title").textContent = title;
      $("ip-dlg-note").textContent = note || "";
      list.innerHTML = "";
      const done = (v) => { d.hidden = true; resolve(v); };
      for (const r of rows) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "ip-opt" + (r.disabled ? " off" : "");
        b.innerHTML = `<b>${esc(r.label)}</b><small>${esc(r.sub || "")}</small>`;
        b.onclick = () => !r.disabled && done(r.value);
        list.appendChild(b);
      }
      $("ip-dlg-cancel").textContent = cancel;
      $("ip-dlg-cancel").onclick = () => done(null);
      d.hidden = false;
    });
  }

  // ---------------------------------------------------------------- creer un colis
  async function makeColis() {
    const inList = task === null;
    if (inList ? !tsel.size : !sel.size) return;
    try {
      const r = inList ? await post("/api/imgproc/zip-tasks", { cat, tasks: [...tsel] }) : await post("/api/imgproc/zip", { cat, task, names: [...sel] });
      toast(`Colis créé : ${r.name} (${r.count} fichier${r.count > 1 ? "s" : ""}${inList ? ` · ${r.tasks} tâche${r.tasks > 1 ? "s" : ""}` : ""}) — en attente de livraison`);
      if (inList) { tsel.clear(); renderTasks(); } else { sel.clear(); renderGrid(); }
    } catch (e) { toast(e.message, true); }
  }

  // ---------------------------------------------------------------- LIVRER LE COLIS
  async function deliver() {
    let colis;
    try { colis = (await api("/api/imgproc/colis")).items; } catch (e) { return toast(e.message, true); }
    if (!colis.length) return toast("Aucun colis en attente : créez-en un d'abord.", true);
    const pick = await dialog("1/2 · CHOISIR LE COLIS À LIVRER",
      colis.map((c) => ({ label: c.name, sub: `${c.count} fichier(s) · ${(c.size / 1024).toFixed(1)} Ko`, value: c.name })));
    if (!pick) return;

    let dests = [];
    try { dests = (await api("/api/imgproc/destinations")).items; } catch (e) {}
    const rows = dests.map((d) => ({ label: d.label, sub: d.ok ? d.path : d.path + "  (dossier introuvable)", value: d.path, disabled: !d.ok }));
    rows.push({ label: "Autre dossier…", sub: "Ouvrir le sélecteur de dossier", value: "__other__" });
    let dest = await dialog("2/2 · CHOISIR LA DESTINATION", rows, { note: "Colis : " + pick });
    if (!dest) return;
    if (dest === "__other__") {
      try { dest = (await post("/api/projects/browse")).path; } catch (e) { return toast(e.message, true); }
      if (!dest) return;
    }

    delivering = true;
    overlayOn("ship", "Votre colis est en cours de livraison...", `${pick}  →  ${dest}`);
    target = 12;
    const ramp = setInterval(() => (target = Math.min(target + 6, 92)), 450);
    let res, err;
    await Promise.all([post("/api/imgproc/deliver", { colis: pick, dest }).then((r) => (res = r)).catch((e) => (err = e)), wait(3000)]);
    clearInterval(ramp);
    if (!err) { target = 100; shown = 100; tickBar(); await wait(600); }
    delivering = false; overlayOff();
    if (err) toast("Livraison impossible : " + err.message, true);
    else toast(`Colis livré : ${res.count} fichier(s) extraits dans ${res.dest}`);
  }

  // ---------------------------------------------------------------- écran de progression (lot de dossier / réparation)
  const fmtT = (s) => (s == null ? "—" : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);
  let qHiddenId = "", qWasActive = "";
  function renderQueue(q) {
    const panel = $("ip-q");
    const has = !!(q && q.id && (q.active || q.finished));
    $("ip-qbtn").hidden = !has;
    if (!has) { panel.hidden = true; return; }
    const done = q.ok + q.failed, sub = q.active ? Math.min(q.sub || 0, 99) / 100 : 0;
    const pct = q.total ? Math.min(100, Math.round(((done + sub) / q.total) * 100)) : 0;
    panel.classList.toggle("done", !q.active);
    $("q-title").textContent = (q.kind === "repair" ? "RÉPARATION · " : "TRAITEMENT · ") + q.name.toUpperCase();
    $("q-now").textContent = q.active ? `Traitement de l'image ${q.index} sur ${q.total}…  ${q.current}` : (q.failed ? `Terminé avec ${q.failed} échec(s)` : "Terminé : tout est installé");
    $("q-stage").textContent = q.active ? q.stage : (q.failed ? "Les images en échec sont restées dans « A faire » : utilisez 🔧 RÉPARER dans MES DOSSIERS." : "");
    $("q-fill").style.width = (q.active ? pct : 100) + "%";
    $("q-pct").textContent = (q.active ? pct : 100) + " %";
    $("q-count").textContent = `${done} / ${q.total} image(s) traitée(s)`;
    $("q-ok").textContent = q.ok; $("q-bad").textContent = q.failed; $("q-bad").classList.toggle("has", q.failed > 0);
    $("q-left").textContent = q.left; $("q-eta").textContent = q.active ? fmtT(q.eta) : "—"; $("q-el").textContent = fmtT(q.elapsed);
    $("q-log").innerHTML = q.events.map((e) => `<li class="${e.k}"><i>${e.t}</i>${e.k === "ok" ? "✔ " : e.k === "bad" ? "✖ " : e.k === "warn" ? "⚠ " : "▶ "}${esc(e.m)}</li>`).join("");
    $("q-hide").hidden = !q.active; $("q-close").hidden = q.active;
    if (q.active) qWasActive = q.id;
    if (q.active || (q.finished && qWasActive === q.id)) {
      if (qHiddenId !== q.id) panel.hidden = false;
    }
    if (q.finished && qWasActive === q.id) {                       // fin de lot : rafraîchit la vue et prévient, une seule fois
      qWasActive = "";
      if (qHiddenId === q.id) toast(q.failed ? `Lot terminé : ${q.ok} installée(s), ${q.failed} en échec` : `Lot terminé : ${q.ok} image(s) installée(s)`, q.failed > 0);
      if (foOpen()) foLoad(); if (panelOpen()) loadView();
    }
  }
  async function closeQueue() {
    $("ip-q").hidden = true;
    try { await post("/api/imgproc/queue/dismiss"); } catch (e) {}
  }

  // ---------------------------------------------------------------- saisie d'un nom (pas de prompt() natif)
  // action(valeur) : appelée au clic sur VALIDER ; si elle lève une erreur, le message s'affiche et la boîte reste ouverte.
  function ask(title, note, action, initial = "") {
    return new Promise((resolve) => {
      const box = $("ip-ask"), inp = $("ip-ask-in"), err = $("ip-ask-err");
      $("ip-ask-title").textContent = title; $("ip-ask-note").textContent = note || "";
      inp.value = initial; err.textContent = ""; box.hidden = false;
      setTimeout(() => { inp.focus(); inp.select(); }, 30);
      const close = (v) => { box.hidden = true; inp.onkeydown = null; resolve(v); };
      const ok = async () => {
        try { close(await action(inp.value.trim())); }
        catch (e) { err.textContent = e.message; box.hidden = false; }
      };
      $("ip-ask-ok").onclick = ok;
      $("ip-ask-cancel").onclick = () => close(null);
      inp.onkeydown = (e) => { if (e.key === "Enter") ok(); else if (e.key === "Escape") { e.stopPropagation(); close(null); } };
    });
  }

  // ---------------------------------------------------------------- fin d'un lot : « Voulez-vous le mettre dans un dossier ? »
  let batchAsking = false;
  async function handleBatch(b) {
    batchAsking = true;
    try {
      await closeQueue();                                     // le récapitulatif a fait son travail : place à la question
      for (;;) {
        const note = `« ${b.name} » : ${b.tasks} image(s) traitée(s)` + (b.failed ? ` · ${b.failed} en échec` : "");
        const pick = await dialog("Voulez-vous le mettre dans un dossier ?", [
          { label: "OUI", sub: "Créer un Dossier Principal puis trier les images en sous-dossiers", value: "y" },
          { label: "NON", sub: "Laisser toutes les images en vrac dans TÂCHES", value: "n" },
        ], { note, cancel: "ANNULER (= NON)" });
        if (pick !== "y") {
          await post("/api/imgproc/batch", { id: b.id, folder: null });
          toast("Images laissées en vrac dans TÂCHES");
          loadView();
          return;
        }
        const r = await ask("NOM DU DOSSIER PRINCIPAL", "Ce dossier contiendra tous vos sous-dossiers et images triées.",
          (name) => post("/api/imgproc/batch", { id: b.id, folder: name }), b.name);
        if (r) { toast(`Dossier « ${r.folder} » créé : ${r.count} image(s) à trier`); loadView(); openOrganizer(r.folder); return; }
      }
    } catch (e) { toast(e.message, true); }
    finally { batchAsking = false; }
  }

  // ---------------------------------------------------------------- organisateur : sous-dossiers, tri, export .zip
  const fo = { folders: [], name: "", tree: null, cur: "", items: [], sel: new Set(), drag: null };
  const foOpen = () => !$("ip-fo").hidden;

  async function openOrganizer(name) {
    $("ip-fo").hidden = false;
    await foLoadFolders(name);
  }

  async function foLoadFolders(want) {
    try { fo.folders = (await api("/api/imgproc/folders")).items; } catch (e) { fo.folders = []; toast(e.message, true); }
    fo.name = want && fo.folders.some((f) => f.name === want) ? want : (fo.folders.some((f) => f.name === fo.name) ? fo.name : (fo.folders[0] || {}).name || "");
    fo.cur = "";
    const pick = $("fo-pick");
    pick.innerHTML = fo.folders.length ? `<select id="fo-sel">${fo.folders.map((f) => `<option value="${esc(f.name)}"${f.name === fo.name ? " selected" : ""}>${esc(f.name)} (${f.count})</option>`).join("")}</select>` : '<span class="dim">Aucun dossier principal</span>';
    if (fo.folders.length) $("fo-sel").onchange = (e) => { fo.name = e.target.value; fo.cur = ""; fo.sel.clear(); foLoad(); };
    await foLoad();
  }

  async function foLoad() {
    $("fo-add").disabled = $("fo-export").disabled = !fo.name;
    if (!fo.name) { fo.tree = null; fo.items = []; fo.sel.clear(); return foRender(); }
    try {
      const r = await api(`/api/imgproc/folder?name=${encodeURIComponent(fo.name)}&sub=${encodeURIComponent(fo.cur)}`);
      fo.tree = r; fo.items = r.items;
    } catch (e) {
      if (fo.cur) { fo.cur = ""; return foLoad(); }                     // sous-dossier disparu
      toast(e.message, true); fo.tree = null; fo.items = [];
    }
    const names = new Set(fo.items.map((i) => i.name));
    fo.sel = new Set([...fo.sel].filter((n) => names.has(n)));
    foRender();
  }

  async function foMove(files, to) {
    try {
      const r = await post("/api/imgproc/folder/move", { folder: fo.name, files: files.map((f) => ({ sub: fo.cur, file: f })), to });
      toast(`${r.moved} image(s) déplacée(s) vers ${to || "Non triés"}`);
      fo.sel.clear(); await foLoad();
    } catch (e) { toast(e.message, true); }
  }

  function foRender() {
    const t = fo.tree, list = $("fo-list");
    $("fo-sub").textContent = fo.name ? `Dossier principal : ${fo.name}` : "Importez un dossier pour commencer";
    list.innerHTML = "";
    if (t) {
      const dirs = [{ sub: "", label: "Non triés", n: t.unsorted }, ...t.subs.map((s) => ({ sub: s.name, label: s.name, n: s.count }))];
      for (const d of dirs) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "fo-dir" + (d.sub === fo.cur ? " on" : "");
        b.innerHTML = `<b>${d.sub ? "📁 " : "📥 "}${esc(d.label)}</b><span>${d.n}</span>`;
        b.onclick = () => { fo.cur = d.sub; fo.sel.clear(); foLoad(); };
        b.ondragover = (e) => { if (fo.drag && d.sub !== fo.cur) { e.preventDefault(); b.classList.add("over"); } };
        b.ondragleave = () => b.classList.remove("over");
        b.ondrop = (e) => { e.preventDefault(); b.classList.remove("over"); if (fo.drag && d.sub !== fo.cur) foMove(fo.drag, d.sub); fo.drag = null; };
        list.appendChild(b);
      }
    }
    const miss = t ? t.missing || 0 : 0;
    $("fo-repair").disabled = !miss; $("fo-repair").textContent = miss ? `🔧 RÉPARER (${miss})` : "🔧 RÉPARER";
    $("fo-where").textContent = t ? (fo.cur ? `▸ ${fo.cur}` : "▸ Non triés") : "";
    $("fo-delsub").hidden = !fo.cur;
    const g = $("fo-grid");
    g.innerHTML = "";
    if (!fo.items.length) g.innerHTML = `<div class="empty">${t ? "— Ce dossier est vide : glissez-y des images —" : "— Aucun dossier —"}</div>`;
    for (const it of fo.items) {
      const b = document.createElement("button");
      b.type = "button"; b.draggable = true;
      b.className = "ip-tile" + (fo.sel.has(it.name) ? " on" : "");
      b.title = it.name;
      b.innerHTML = `<span class="chk">✔</span><img alt="" draggable="false" src="${it.thumb}"><small>${esc(it.name)}</small>`;
      b.onclick = () => { fo.sel.has(it.name) ? fo.sel.delete(it.name) : fo.sel.add(it.name); b.classList.toggle("on"); foBar(); };
      b.ondragstart = (e) => { fo.drag = fo.sel.has(it.name) ? [...fo.sel] : [it.name]; e.dataTransfer.setData("text/plain", it.name); e.dataTransfer.effectAllowed = "move"; };
      b.ondragend = () => (fo.drag = null);
      g.appendChild(b);
    }
    foBar();
  }

  function foBar() {
    $("fo-count").textContent = `${fo.sel.size} / ${fo.items.length} sélectionnée(s)`;
    $("fo-move").disabled = fo.sel.size === 0;
    $("fo-all").textContent = fo.sel.size === fo.items.length && fo.items.length ? "TOUT DÉSÉLECTIONNER" : "TOUT SÉLECTIONNER";
  }

  async function foExport() {
    let dest = "";
    try { dest = (await api("/api/imgproc/folder/export-dest")).path; } catch (e) {}
    if (!dest) {                                                   // « BIN A JEU » introuvable : on demande la destination
      let dests = [];
      try { dests = (await api("/api/imgproc/destinations")).items; } catch (e) {}
      const rows = dests.map((d) => ({ label: d.label, sub: d.ok ? d.path : d.path + "  (dossier introuvable)", value: d.path, disabled: !d.ok }));
      rows.push({ label: "Autre dossier…", sub: "Ouvrir le sélecteur de dossier", value: "__other__" });
      dest = await dialog("« BIN A JEU » INTROUVABLE · CHOISIR LA DESTINATION", rows, { note: "Export : " + fo.name + ".zip" });
      if (!dest) return;
      if (dest === "__other__") {
        try { dest = (await post("/api/projects/browse")).path; } catch (e) { return toast(e.message, true); }
        if (!dest) return;
      }
    }
    delivering = true;
    overlayOn("ship", "Export du dossier en .zip…", `${fo.name}  →  ${dest}`);
    target = 15;
    const ramp = setInterval(() => (target = Math.min(target + 8, 92)), 400);
    let res, err;
    await Promise.all([post("/api/imgproc/folder/export", { folder: fo.name, dest }).then((r) => (res = r)).catch((e) => (err = e)), wait(1500)]);
    clearInterval(ramp);
    if (!err) { target = 100; shown = 100; tickBar(); await wait(500); }
    delivering = false; overlayOff();
    if (err) toast("Export impossible : " + err.message, true);
    else toast(`Export terminé : ${res.count} image(s) → ${res.zip}`);
  }

  function initOrganizer() {
    $("ip-folders").onclick = () => openOrganizer(fo.name);
    $("fo-x").onclick = () => { $("ip-fo").hidden = true; };
    $("fo-all").onclick = () => { fo.sel.size === fo.items.length ? fo.sel.clear() : (fo.sel = new Set(fo.items.map((i) => i.name))); foRender(); };
    $("fo-export").onclick = foExport;
    $("fo-repair").onclick = async () => {
      const t = fo.tree; if (!t || !t.missing) return;
      const ok = await dialog(`RÉPARER « ${fo.name} » ?`, [{ label: `Reprendre les ${t.missing} image(s) restée(s) dans « A faire »`, sub: "Seules ces images sont traitées ; les résultats sont AJOUTÉS à ce dossier (aucun fichier existant n'est modifié ni écrasé).", value: "y" }], { note: "Un écran de progression s'affichera." });
      if (ok !== "y") return;
      try { const r = await post("/api/imgproc/folder/repair", { folder: fo.name }); toast(`Réparation lancée : ${r.count} image(s)`); poll(); }
      catch (e) { toast(e.message, true); }
    };
    $("q-hide").onclick = () => { qHiddenId = (lastSt && lastSt.queue && lastSt.queue.id) || ""; $("ip-q").hidden = true; };
    $("q-close").onclick = closeQueue;
    $("ip-qbtn").onclick = () => { qHiddenId = ""; if (lastSt) renderQueue(lastSt.queue); };
    $("fo-add").onclick = async () => {
      const r = await ask("NOUVEAU DOSSIER", `Sous-dossier de « ${fo.name} » (ex. Bâtiments, Tiles, Interactif…)`,
        (name) => post("/api/imgproc/folder/sub", { folder: fo.name, sub: name }));
      if (r) { fo.cur = r.name; fo.sel.clear(); foLoad(); }
    };
    $("fo-move").onclick = async () => {
      const t = fo.tree; if (!t || !fo.sel.size) return;
      const rows = [{ label: "Non triés", sub: "Racine du dossier principal", value: "", disabled: fo.cur === "" }]
        .concat(t.subs.map((s) => ({ label: s.name, sub: `${s.count} image(s)`, value: s.name, disabled: s.name === fo.cur })));
      const to = await dialog(`DÉPLACER ${fo.sel.size} IMAGE(S) VERS…`, rows, { note: "Astuce : vous pouvez aussi glisser-déposer les images sur un dossier" });
      if (to !== null) foMove([...fo.sel], to);
    };
    $("fo-delsub").onclick = async () => {
      const ok = await dialog(`SUPPRIMER « ${fo.cur} » ?`, [{ label: "Supprimer ce dossier", sub: "Ses images retournent dans « Non triés » (rien n'est perdu)", value: "y" }]);
      if (ok !== "y") return;
      try { await post("/api/imgproc/folder/sub-delete", { folder: fo.name, sub: fo.cur }); fo.cur = ""; fo.sel.clear(); foLoad(); }
      catch (e) { toast(e.message, true); }
    };
    $("ip-fbtn").onclick = async () => {
      try {
        const b = await post("/api/projects/browse");
        if (!b.path) { if (b.error) toast(b.error, true); return; }
        const r = await post("/api/imgproc/import-folder", { cat, path: b.path });
        toast(`Dossier « ${r.name} » : ${r.count} image(s) envoyée(s) au traitement (traitées une par une)`); poll();
      } catch (e) { toast(e.message, true); }
    };
  }

  // ---------------------------------------------------------------- branchement
  function init() {
    const open = $("b-ip");
    if (!open) return;
    open.onclick = openPanel;
    $("ip-close").onclick = closePanel;
    initDownloads();
    initOrganizer();
    document.querySelectorAll("#ip-tabs button").forEach((b) => (b.onclick = () => setCat(b.dataset.c)));
    $("ip-all").onclick = () => {
      if (task === null) { tsel.size === taskList.length ? tsel.clear() : (tsel = new Set(taskList.map((t) => t.name))); renderTasks(); }
      else { sel.size === items.length ? sel.clear() : (sel = new Set(items.map((i) => i.name))); renderGrid(); }
    };
    $("ip-refresh").onclick = loadView;
    $("ip-back").onclick = () => { task = null; sel.clear(); loadView(); };
    $("ip-open").onclick = () => post("/api/imgproc/open", { cat }).catch((e) => toast(e.message, true));
    $("ip-retry").onclick = async () => { await post("/api/imgproc/retry"); poll(); };
    $("ip-zip").onclick = makeColis;
    $("ip-ship").onclick = deliver;
    $("ip-conv").onclick = async () => {                // confirmation en deux clics : la tâche Simple est supprimée en cas de succès
      const b = $("ip-conv");
      if (!b.classList.contains("armed")) {
        b.classList.add("armed"); b.textContent = `Confirmer : découper ${task} vers Image Multiple ?`;
        convArm = setTimeout(updBar, 5000); return;
      }
      try { await post("/api/imgproc/to-multiple", { task }); poll(); }
      catch (e) { toast(e.message, true); updBar(); }
    };
    $("ip-clean").onclick = async () => {              // confirmation en deux clics (pas de boite confirm())
      const b = $("ip-clean");
      if (!b.classList.contains("armed")) {
        b.classList.add("armed"); b.textContent = "Confirmer : supprimer TOUTES les tâches ?";
        cleanArm = setTimeout(updBar, 4000); return;
      }
      try { const r = await post("/api/imgproc/clean", { cat }); toast(`Dossier Livraison vidé (${r.removed} tâche(s) supprimée(s)) — compteur remis à 1`); task = null; sel.clear(); loadView(); }
      catch (e) { toast(e.message, true); }
    };
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !$("ip-dlg").hidden || !$("ip-ask").hidden || !$("ip-ov").hidden) return;
      if (foOpen()) $("ip-fo").hidden = true;
      else if (panelOpen() && $("cm").hidden) closePanel();
    });
    setTimeout(() => { poll(); setInterval(poll, 1200); }, 2500);      // laisse à l'interface le temps de savoir si elle tourne sur un téléphone (routes réservées au PC)
  }
  // écran de chargement partagé avec les autres modules (compression média)
  window.nasko_ov = { on: overlayOn, off: overlayOff, setTarget: (t) => { target = t; }, finish: () => { target = 100; shown = 100; tickBar(); } };
  init();
})();
