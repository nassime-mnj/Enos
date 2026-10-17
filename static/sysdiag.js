"use strict";
// Onglets « Diagnostic » (RAM / CPU / GPU / stockage) et « Godot » du tableau de bord système. Lecture seule : aucune action n'est exécutée sur le PC.
(() => {
  const S = window.enosSys;
  if (!S) return;
  const { api, esc, num, bytes, rate, flash } = S;
  const LV = { danger: "CRITIQUE", warn: "ATTENTION", info: "INFO", ok: "OK" };
  const ORDER = { danger: 0, warn: 1, info: 2, ok: 3 };
  const pill = (lv, txt) => `<span class="sd-pill ${lv}">${esc(txt || LV[lv])}</span>`;
  const mini = (p) => `<div class="sd-mini"><i style="--v:${Math.max(0, Math.min(100, p || 0))}%"></i></div>`;
  const tbl = (head, rows) => `<div class="sd-tblw"><table class="sd-tbl"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const findings = (list) => [...list].sort((a, b) => ORDER[a.level] - ORDER[b.level]).map((f) => `<div class="sd-find ${f.level}">${pill(f.level)}<div><b>${esc(f.title)}</b>${f.detail ? `<div class="d">${esc(f.detail)}</div>` : ""}${f.hint ? `<div class="h">➜ ${esc(f.hint)}</div>` : ""}</div></div>`).join("");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ================================================================== DIAGNOSTIC
  let diag = null, scan = null, dRunning = false, sRunning = false, dPane = null;

  function diagHtml() {
    const bar = `<div class="sd-bar"><button class="btn" id="dg-run" ${dRunning ? "disabled" : ""}>${dRunning ? "⟳ MESURE EN COURS…" : diag ? "↻ RELANCER" : "▶ LANCER LE DIAGNOSTIC"}</button>
      <span class="sd-note">Lecture seule · environ 10 s · identifie ce qui sature la RAM, le CPU, le GPU et le disque</span></div>`;
    if (!diag) return bar + `<div class="sd-empty">Aucun diagnostic pour l'instant. Lancez-le pendant que le problème se produit (jeu ou Godot ouvert) pour voir le vrai coupable.</div>`;
    if (diag.error) return bar + `<div class="sd-find danger">${pill("danger")}<div><b>${esc(diag.error)}</b></div></div>`;
    const nD = diag.findings.filter((f) => f.level === "danger").length, nW = diag.findings.filter((f) => f.level === "warn").length;
    const head = `<h3 class="sd-h">Résumé <small>${nD} critique(s), ${nW} avertissement(s) · mesuré à ${new Date(diag.at * 1000).toLocaleTimeString("fr-FR")} en ${diag.took} s</small></h3><div class="sd-finds">${findings(diag.findings)}</div>`;
    const r = diag.ram, c = diag.cpu, g = diag.gpu, s = diag.storage;
    const ram = `<div class="cb-card"><h4>RAM — qui la consomme</h4>${S.bar("Utilisée", num(r.used_gb, 1) + " / " + num(r.total_gb, 1) + " Go", r.pct)}${r.swap_total_gb ? S.row("Fichier d'échange", num(r.swap_used_gb, 1) + " / " + num(r.swap_total_gb, 1) + " Go") : ""}
      ${tbl(["Application", "Mémoire", "Part"], r.top.slice(0, 8).map((x) => [esc(x.label) + (x.count > 1 ? ` <small>×${x.count}</small>` : ""), bytes(x.mem_mb * 2 ** 20), mini(x.share * 3) + `<small>${num(x.share, 0)} %</small>`]))}</div>`;
    const cpu = `<div class="cb-card"><h4>CPU — qui le consomme</h4>${S.bar("Charge", num(c.util, 0) + " % sur " + c.logical + " cœurs logiques", c.util)}${c.mhz ? S.row("Fréquence", num(c.mhz) + " MHz" + (c.mhz_max ? " (max " + num(c.mhz_max) + ")" : "")) : ""}
      ${tbl(["Application", "CPU", ""], c.top.slice(0, 8).map((x) => [esc(x.label) + (x.count > 1 ? ` <small>×${x.count}</small>` : ""), num(x.cpu, 1) + " %", mini(x.cpu * 2)]))}</div>`;
    const nv = g.nvidia;
    const gpu = `<div class="cb-card"><h4>GPU — qui le consomme</h4>${nv ? S.bar(nv.name, num(nv.util, 0) + " % · " + num(nv.temp, 0) + " °C · " + num(nv.watts, 0) + " W", nv.util) + S.bar("VRAM", num(nv.mem_used_mb / 1024, 1) + " / " + num(nv.mem_total_mb / 1024, 1) + " Go", nv.mem_used_mb / nv.mem_total_mb * 100) : '<div class="sd-empty">nvidia-smi indisponible</div>'}
      ${g.top.length ? tbl(["Processus", "GPU", "VRAM", "Carte"], g.top.filter((x) => x.util >= 1 || x.vram_mb >= 50).slice(0, 8).map((x) => [esc(x.name), num(x.util, 0) + " %", num(x.vram_mb) + " Mo", `<small>${esc(x.adapter)}</small>`])) : '<div class="sd-empty">Aucun processus ne sollicite le GPU</div>'}</div>`;
    const vols = s.volumes.map((v) => S.bar(`${v.mount} (${v.fstype})`, `${num(v.free_gb, 0)} Go libres / ${num(v.total_gb)} Go`, v.pct)).join("");
    const sto = `<div class="cb-card"><h4>Stockage — ce qui sature</h4>${vols}
      ${s.busy != null ? S.row("Activité disque", num(s.busy) + " % · file " + num(s.queue, 1)) + S.row("Débit", "↓ " + rate(s.read_bps) + " · ↑ " + rate(s.write_bps)) : ""}
      ${Object.keys(s.special).length ? S.row("Fichiers système", Object.entries(s.special).filter(([, v]) => v > 0).map(([k, v]) => `${esc(k)} ${num(v, 1)} Go`).join(" · ")) : ""}
      ${s.io_top.length ? tbl(["Plus gros E/S", "Lecture", "Écriture"], s.io_top.slice(0, 6).map((x) => [esc(x.label), rate(x.io_r), rate(x.io_w)])) : ""}
      <div class="sd-bar"><button class="btn" id="dg-scan" ${sRunning ? "disabled" : ""}>${sRunning ? "⟳ ANALYSE…" : "🗂 ANALYSER LE CONTENU DU DISQUE"}</button><span class="sd-note" id="dg-scanp">${scan && scan.state === "running" ? esc(scan.progress) : "dossiers les plus gros, plus gros fichiers (≈ 1 min)"}</span></div></div>`;
    return bar + head + `<div class="cb-grid sd-diag">${ram}${cpu}${gpu}${sto}</div>${scanHtml()}`;
  }

  function scanHtml() {
    if (!scan || scan.state !== "done" || !scan.result) return scan && scan.state === "error" ? `<div class="sd-find danger">${pill("danger")}<div><b>${esc(scan.error)}</b></div></div>` : "";
    const r = scan.result, max = Math.max(1, ...r.folders.map((f) => f.size));
    return `<h3 class="sd-h">Contenu du disque <small>analysé en ${r.took} s · dossiers du profil, AppData, Temp, Windows.old</small></h3>
      ${r.findings.length ? `<div class="sd-finds">${findings(r.findings)}</div>` : ""}
      <div class="cb-grid sd-diag"><div class="cb-card"><h4>Dossiers les plus volumineux</h4>${tbl(["Dossier", "Taille", ""], r.folders.slice(0, 14).map((f) => [`<span title="${esc(f.path)}">${esc(f.path.replace(/^C:\\Users\\[^\\]+/i, "~"))}</span>${f.partial ? " <small>(partiel)</small>" : ""}${f.cloud ? ` <small>+${bytes(f.cloud, 0)} en ligne seulement</small>` : ""}`, bytes(f.size), mini(f.size / max * 100)]))}</div>
      <div class="cb-card"><h4>Plus gros fichiers (> 200 Mo)</h4>${r.big_files.length ? tbl(["Fichier", "Taille"], r.big_files.slice(0, 12).map((f) => [`<span title="${esc(f.path)}">${esc(f.path.replace(/^C:\\Users\\[^\\]+/i, "~"))}</span>`, bytes(f.size)])) : '<div class="sd-empty">Aucun fichier de plus de 200 Mo dans les dossiers analysés</div>'}</div></div>`;
  }

  async function runDiag() {
    if (dRunning) return;
    dRunning = true; paintDiag();
    try { diag = await api("diag", {}); flash(""); } catch (e) { flash("⚠ " + e.message, true); }
    dRunning = false; paintDiag(); if (window.enosMotion && dPane) window.enosMotion.reveal(dPane, { max: 30 });
  }
  async function runScan() {
    if (sRunning) return;
    sRunning = true; paintDiag();
    try {
      scan = await api("storage/scan", {});
      while (scan.state === "running") { await sleep(1200); if (!dPane || !document.body.contains(dPane)) break; scan = await api("storage/scan"); const el = document.getElementById("dg-scanp"); if (el) el.textContent = scan.progress; }
    } catch (e) { flash("⚠ " + e.message, true); }
    sRunning = false; paintDiag(); if (window.enosMotion && dPane) window.enosMotion.reveal(dPane, { max: 30 });
  }
  function paintDiag() { if (dPane && document.body.contains(dPane)) dPane.querySelector("#dg-root").innerHTML = diagHtml(); }

  S.register("diag", {
    title: "Diagnostic",
    render(pane) {
      dPane = pane;
      pane.innerHTML = '<div id="dg-root"></div>';
      paintDiag();
      pane.onclick = (e) => { if (e.target.closest("#dg-run")) runDiag(); else if (e.target.closest("#dg-scan")) runScan(); };
    },
  });

  // ================================================================== GODOT
  let gp = null, gProjects = null, gSel = "", gJob = null, gRes = null, gLive = null, gRunning = false, gLiveBusy = false;
  const GROUP = { environnement: ["Windows, GPU, antivirus et disque", "Hors de Godot : souvent le plus gros gain, aucun effet sur l'image."], sans_perte: ["Sans aucune perte visuelle", "Réglages du projet et de l'éditeur : l'image reste identique."], compromis: ["Compromis : à vous de juger", "Un gain réel mais un effet visuel possible. Jamais appliqué automatiquement."] };
  const IMP = { high: "Impact fort", medium: "Impact moyen", low: "Impact faible" };

  function recHtml(r, i) {
    return `<details class="sd-rec" ${r.impact === "high" && i < 3 ? "open" : ""}><summary><span class="sd-pill imp-${r.impact}">${IMP[r.impact]}</span><b>${esc(r.title)}</b></summary>
      <div class="sd-recb"><div><span class="k">Ce qui a été mesuré</span>${esc(r.evidence)}</div><div><span class="k">Comment faire</span>${esc(r.how)}</div>${r.gain ? `<div><span class="k">Ce que ça améliore</span>${esc(r.gain)}</div>` : ""}</div></details>`;
  }

  function godotHtml() {
    const opts = (gProjects || []).map((p) => `<option value="${esc(p.path)}" ${p.path === gSel ? "selected" : ""}>${esc(p.name)} — ${esc(p.src)}</option>`).join("");
    const bar = `<div class="sd-bar"><select id="gd-proj" ${gRunning ? "disabled" : ""}>${opts || "<option>Aucun projet trouvé</option>"}</select>
      <button class="btn" id="gd-run" ${gRunning || !gProjects || !gProjects.length ? "disabled" : ""}>${gRunning ? "⟳ ANALYSE EN COURS…" : "▶ ANALYSER LE PROJET"}</button>
      <button class="btn" id="gd-live" ${gLiveBusy ? "disabled" : ""}>${gLiveBusy ? "⟳ MESURE…" : "◉ MESURER GODOT EN COURS"}</button>
      <span class="sd-note" id="gd-prog">${gRunning && gJob ? esc(gJob.progress) : "Lecture seule : rien n'est modifié dans votre projet ni dans Godot"}</span></div>`;
    let html = bar;
    if (gLive) html += `<h3 class="sd-h">Godot en cours d'exécution</h3><div class="sd-finds">${findings(gLive.findings)}</div>` + (gLive.procs.length ? tbl(["Processus", "Rôle", "CPU", "RAM", "GPU", "VRAM", "Carte utilisée"], gLive.procs.map((p) => [`pid ${p.pid}`, esc(p.role), num(p.cpu, 0) + " %", bytes(p.mem_mb * 2 ** 20), num(p.gpu_util, 0) + " %", num(p.vram_mb) + " Mo", esc(p.adapters.join(", ") || "—")])) : "");
    if (!gRes) return html + (gRunning ? "" : `<div class="sd-empty">Choisissez un projet puis lancez l'analyse (≈ 20 s). Elle lit vos réglages, vos scènes, vos textures et votre environnement Windows, puis propose des optimisations classées par risque visuel.</div>`);
    const r = gRes, st = r.stats;
    html += `<h3 class="sd-h">${esc(r.name)} <small>${esc(r.renderer)}${r.godot_version ? " · Godot " + esc(r.godot_version) : ""} · analysé en ${r.took} s</small></h3>
      <div class="sd-kpis">${[["Fichiers", num(st.files)], ["Taille", num(st.gb, 1) + " Go"], ["Fichiers .import", num(st.imports)], ["Cache .godot", num(st.cache_gb, 1) + " Go"], ["Scènes analysées", num(r.scenes.scanned)], ["Scripts", num(r.scripts.scanned)]].map(([k, v]) => `<div class="sd-kpi"><b>${v}</b><span>${k}</span></div>`).join("")}</div>`;
    for (const g of ["environnement", "sans_perte", "compromis"]) {
      const items = r.recs.filter((x) => x.group === g);
      if (!items.length) continue;
      html += `<h3 class="sd-h g-${g}">${GROUP[g][0]} <small>${GROUP[g][1]}</small></h3><div class="sd-recs">${items.map(recHtml).join("")}</div>`;
    }
    if (r.ok.length) html += `<h3 class="sd-h">Déjà bien réglé</h3><div class="sd-finds">${r.ok.map((t) => `<div class="sd-find ok">${pill("ok")}<div><b>${esc(t)}</b></div></div>`).join("")}</div>`;
    html += `<details class="sd-more"><summary>Détails de l'analyse</summary><div class="cb-grid sd-diag">
      <div class="cb-card"><h4>Types de fichiers</h4>${tbl(["Type", "Nombre", "Poids"], st.ext.map((e) => [esc(e.ext), num(e.n), num(e.mb) + " Mo"]))}</div>
      <div class="cb-card"><h4>Dossiers principaux</h4>${tbl(["Dossier", "Fichiers", "Poids"], st.dirs.map((d) => [esc(d.dir), num(d.n), num(d.mb) + " Mo"]))}</div>
      <div class="cb-card"><h4>Textures les plus lourdes en VRAM</h4>${r.textures.top.length ? tbl(["Image", "Taille", "VRAM"], r.textures.top.slice(0, 8).map((t) => [`<span title="${esc(t.path)}">${esc(t.path.split("/").slice(-2).join("/"))}</span>`, `${t.w}×${t.h}`, num(t.mb) + " Mo"])) : '<div class="sd-empty">—</div>'}</div>
      <div class="cb-card"><h4>Nœuds les plus fréquents</h4>${tbl(["Type", "Nombre"], r.scenes.types.map((t) => [esc(t[0]), num(t[1])]))}</div>
      <div class="cb-card"><h4>Réglages lus</h4>${[["V-Sync", r.settings.vsync_mode == null ? "défaut" : r.settings.vsync_mode], ["Max FPS", r.settings.max_fps || "illimité"], ["Pilote de rendu", r.settings.driver || "défaut"], ["HDR 2D", r.settings.hdr_2d || "non"], ["Physique 3D", r.settings.physics_3d || "défaut"], ["Autoloads", r.settings.autoloads], ["_process / _physics_process", r.scripts.process + " / " + r.scripts.physics], ["GPU", r.gpus.join(" + ") || "—"], ["Préférence GPU Windows", r.gpu_pref], ["Antivirus", r.antivirus.join(", ") || "aucun détecté"]].map(([k, v]) => S.row(k, esc(v))).join("")}</div></div></details>`;
    return html;
  }

  function paintGodot() { if (gp && document.body.contains(gp)) gp.querySelector("#gd-root").innerHTML = godotHtml(); }

  async function analyze() {
    if (gRunning) return;
    gRunning = true; gJob = { progress: "démarrage…" }; paintGodot();
    try {
      gJob = await api("godot/analyze", { project: gSel || null });
      while (gJob.state === "running") {
        await sleep(900);
        if (!gp || !document.body.contains(gp)) break;
        gJob = await api("godot/analyze");
        const el = document.getElementById("gd-prog"); if (el) el.textContent = gJob.progress;
      }
      if (gJob.state === "done") { gRes = gJob.result; flash(""); } else if (gJob.state === "error") flash("⚠ " + gJob.error, true);
    } catch (e) { flash("⚠ " + e.message, true); }
    gRunning = false; paintGodot(); if (window.enosMotion && gp) window.enosMotion.reveal(gp, { max: 30 });
  }
  async function live() {
    if (gLiveBusy) return;
    gLiveBusy = true; paintGodot();
    try { gLive = await api("godot/live"); flash(""); } catch (e) { flash("⚠ " + e.message, true); }
    gLiveBusy = false; paintGodot();
  }

  S.register("godot", {
    title: "Godot",
    render(pane) {
      gp = pane;
      pane.innerHTML = '<div id="gd-root"></div>';
      paintGodot();
      pane.onclick = (e) => { if (e.target.closest("#gd-run")) analyze(); else if (e.target.closest("#gd-live")) live(); };
      pane.onchange = (e) => { if (e.target.id === "gd-proj") gSel = e.target.value; };
      if (!gProjects) api("godot/projects").then((d) => { gProjects = d.projects; if (!gSel && gProjects.length) gSel = gProjects[0].path; paintGodot(); }).catch((e) => flash("⚠ " + e.message, true));
    },
  });
})();
