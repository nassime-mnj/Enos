"use strict";
// DEEP SYSTEM CLEANER : scan profond, filtres catégorie / risque, suppression guidée. Le serveur recalcule et impose les règles de sécurité.
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { "X-Nasko-Token": TOKEN, "Content-Type": "application/json" } });
    if (!r.ok) {
      let d = r.statusText;
      try { d = (await r.json()).detail || d; } catch (e) {}
      throw new Error(typeof d === "string" ? d : "requête refusée");
    }
    return r.json();
  }
  const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b || {}) });
  const bytes = (n) => (n < 1048576 ? (n / 1024).toFixed(0) + " Ko" : n < 1073741824 ? (n / 1048576).toFixed(0) + " Mo" : (n / 1073741824).toFixed(2) + " Go");
  const dur = (s) => (s >= 60 ? Math.floor(s / 60) + " min " : "") + Math.round(s % 60) + " s";
  const ICON = { green: "🟢", orange: "🟠", red: "🔴" };
  const RLABEL = { green: "ULTRA SAFE", orange: "MOINS SAFE", red: "À RISQUE" };
  const PAGE = 400;

  let items = [], cats = {}, fCat = "all", fRisk = "all", fText = "", sortDesc = true, shown = PAGE, picked = new Set(), timer = 0, toastT = 0, pending = null;
  const isOpen = () => !$("dc").hidden;

  const toast = (msg, bad) => {
    const t = $("dc-toast");
    t.textContent = msg;
    t.className = "dc-toast show" + (bad ? " bad" : "");
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.className = "dc-toast"), 5000);
  };

  // ---------------------------------------------------------------- ouverture + état du disque
  async function open() {
    $("dc").hidden = false;
    let st;
    try { st = await api("/api/cleaner/state"); } catch (e) { return toast(e.message, true); }
    renderDisk(st.disk);
    if (st.phase === "scanning") poll();
    else if (st.phase === "done" && !items.length) await loadResults();
  }
  function close() { $("dc").hidden = true; clearTimeout(timer); }

  function renderDisk(d) {
    if (!d) return;
    const pct = Math.round((d.used / d.total) * 100);
    $("dc-dbar-i").style.width = pct + "%";
    $("dc-disk").dataset.lvl = pct >= 95 ? "crit" : pct >= 85 ? "warn" : "ok";
    $("dc-dtxt").textContent = `${d.drive}  ·  ${bytes(d.free)} libres sur ${bytes(d.total)}  (${pct} % utilisés)`;
  }

  // ---------------------------------------------------------------- scan
  async function scan() {
    try {
      picked.clear(); items = [];
      await post("/api/cleaner/scan", { min_mb: +$("dc-min").value, scope: $("dc-scope").value });
      ["dc-filters", "dc-legend", "dc-tablewrap", "dc-actbar", "dc-empty"].forEach((id) => ($(id).hidden = true));
      poll();
    } catch (e) { toast(e.message, true); }
  }

  async function poll() {
    clearTimeout(timer);
    if (!isOpen()) return;
    let st;
    try { st = await api("/api/cleaner/state"); } catch (e) { return toast(e.message, true); }
    renderDisk(st.disk);
    const scanning = st.phase === "scanning";
    $("dc-prog").hidden = !scanning;
    $("dc-go").hidden = scanning;
    $("dc-stop").hidden = !scanning;
    ["dc-min", "dc-scope"].forEach((id) => ($(id).disabled = scanning));
    if (scanning) {
      $("dc-ptxt").textContent = `${st.files.toLocaleString("fr-FR")} fichiers · ${st.dirs.toLocaleString("fr-FR")} dossiers · ${bytes(st.bytes)} analysés · ${dur(st.elapsed)}${st.denied ? " · " + st.denied + " accès refusés" : ""}  —  ${st.current}`;
      timer = setTimeout(poll, 400);
    } else if (st.phase === "done") {
      await loadResults(st);
    } else if (st.phase === "error") {
      toast(st.message, true);
    }
  }

  async function loadResults(st) {
    const r = await api("/api/cleaner/results");
    items = r.items; cats = r.cats; fCat = "all"; fRisk = "all"; fText = ""; $("dc-q").value = ""; shown = PAGE; picked.clear();
    if (st && st.message) toast(st.message);
    renderAll();
  }

  // ---------------------------------------------------------------- filtres + tableau
  const visible = () => {
    const q = fText.toLowerCase();
    const v = items.filter((i) => (fCat === "all" || i.cat === fCat) && (fRisk === "all" || i.risk === fRisk) && (!q || i.path.toLowerCase().includes(q)));
    return v.sort((a, b) => (sortDesc ? b.size - a.size : a.size - b.size));
  };

  function chip(label, value, count, size, cur, onPick, cls) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dc-chip" + (cur === value ? " on" : "") + (cls ? " " + cls : "");
    const l = document.createElement("span"); l.textContent = label;
    const c = document.createElement("em"); c.textContent = count + (size ? " · " + bytes(size) : "");
    b.append(l, c);
    b.onclick = () => { onPick(value); shown = PAGE; renderAll(); };
    return b;
  }

  function renderChips() {
    const base = (pred) => items.filter(pred);
    const catsEl = $("dc-cats"), risksEl = $("dc-risks");
    catsEl.replaceChildren(); risksEl.replaceChildren();
    const inRisk = base((i) => fRisk === "all" || i.risk === fRisk);          // les compteurs de catégories tiennent compte du filtre de risque, et inversement
    const inCat = base((i) => fCat === "all" || i.cat === fCat);
    const sum = (a) => a.reduce((s, i) => s + i.size, 0);
    catsEl.append(chip("Tout", "all", inRisk.length, sum(inRisk), fCat, (v) => (fCat = v)));
    Object.keys(cats).forEach((k) => {
      const a = inRisk.filter((i) => i.cat === k);
      if (a.length) catsEl.append(chip(cats[k], k, a.length, sum(a), fCat, (v) => (fCat = v)));
    });
    risksEl.append(chip("Tous risques", "all", inCat.length, sum(inCat), fRisk, (v) => (fRisk = v)));
    ["green", "orange", "red"].forEach((k) => {
      const a = inCat.filter((i) => i.risk === k);
      risksEl.append(chip(ICON[k] + " " + RLABEL[k], k, a.length, sum(a), fRisk, (v) => (fRisk = v), "r-" + k));
    });
  }

  function renderRows() {
    const list = visible();
    const tb = $("dc-rows");
    tb.replaceChildren();
    const frag = document.createDocumentFragment();
    list.slice(0, shown).forEach((it) => {
      const tr = document.createElement("tr");
      tr.className = "r-" + it.risk;
      const td = (cls) => { const c = document.createElement("td"); if (cls) c.className = cls; tr.append(c); return c; };
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = picked.has(it.id); cb.disabled = it.risk === "red";
      cb.title = it.risk === "red" ? "Suppression bloquée : fichier système" : "";
      cb.onchange = () => { cb.checked ? picked.add(it.id) : picked.delete(it.id); updateBar(); };
      td("c").append(cb);
      const tag = document.createElement("span");
      tag.className = "dc-tag " + it.risk; tag.textContent = ICON[it.risk] + " " + RLABEL[it.risk]; tag.title = it.reason;
      td().append(tag);
      td("t").textContent = cats[it.cat] || it.cat;
      td("r s").textContent = bytes(it.size);
      const f = td("f");
      const n = document.createElement("b"); n.textContent = it.name;
      const p = document.createElement("small"); p.textContent = it.dir + (it.onedrive ? "  ☁ OneDrive" : ""); p.title = it.path;
      f.append(n, p);
      const o = document.createElement("button");
      o.type = "button"; o.className = "dc-open"; o.textContent = "📂"; o.title = "Afficher dans l'Explorateur";
      o.onclick = () => post("/api/cleaner/reveal", { id: it.id }).catch((e) => toast(e.message, true));
      td("o").append(o);
      frag.append(tr);
    });
    tb.append(frag);
    if (list.length > shown) {
      const tr = document.createElement("tr");
      const c = document.createElement("td"); c.colSpan = 6; c.className = "more";
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn sm"; b.textContent = `AFFICHER ${Math.min(PAGE, list.length - shown)} DE PLUS (${list.length - shown} restants)`;
      b.onclick = () => { shown += PAGE; renderRows(); };
      c.append(b); tr.append(c); tb.append(tr);
    }
    $("dc-tablewrap").hidden = !list.length;
    const e = $("dc-empty");
    e.hidden = list.length > 0;
    e.textContent = items.length ? "Aucun fichier ne correspond aux filtres." : "Aucun fichier au-dessus du seuil : essayez un seuil plus bas.";
    $("dc-all").checked = false;
    updateBar();
  }

  function renderAll() {
    const has = items.length > 0;
    ["dc-filters", "dc-legend"].forEach((id) => ($(id).hidden = !has));
    $("dc-actbar").hidden = !has;
    renderChips();
    renderRows();
  }

  function updateBar() {
    const sel = items.filter((i) => picked.has(i.id));
    const total = sel.reduce((s, i) => s + i.size, 0);
    $("dc-sel").textContent = sel.length ? `${sel.length} sélectionné${sel.length > 1 ? "s" : ""} · ${bytes(total)} à libérer` : "Aucune sélection";
    $("dc-del").disabled = !sel.length;
  }

  // ---------------------------------------------------------------- suppression : confirmation à deux niveaux
  function line(parent, cls, text) { const d = document.createElement("div"); d.className = cls; d.textContent = text; parent.append(d); return d; }

  function askDelete() {
    const sel = items.filter((i) => picked.has(i.id));
    if (!sel.length) return;
    const perm = $("dc-perm").checked;
    const by = { green: [], orange: [], red: [] };
    sel.forEach((i) => by[i.risk].push(i));
    if (by.red.length) return toast("Des fichiers 🔴 système sont sélectionnés : ils ne peuvent pas être supprimés.", true);
    const total = sel.reduce((s, i) => s + i.size, 0);
    const body = $("dc-mb");
    body.replaceChildren();
    $("dc-mt").textContent = `Supprimer ${sel.length} fichier${sel.length > 1 ? "s" : ""} (${bytes(total)}) ?`;
    line(body, "dc-m-ok", `🟢 ${by.green.length} ultra safe · ${bytes(by.green.reduce((s, i) => s + i.size, 0))}`);
    let needAck = false;
    if (by.orange.length) {
      needAck = true;
      line(body, "dc-m-warn", `🟠 ${by.orange.length} fichier(s) MOINS SAFE (${bytes(by.orange.reduce((s, i) => s + i.size, 0))}) : programmes, données d'applications ou emplacement non classé. Les supprimer peut casser un logiciel ou perdre des données. Vérifiez la liste :`);
      const ul = document.createElement("ul");
      by.orange.slice(0, 8).forEach((i) => { const li = document.createElement("li"); li.textContent = i.path; ul.append(li); });
      if (by.orange.length > 8) { const li = document.createElement("li"); li.textContent = `… et ${by.orange.length - 8} autres`; ul.append(li); }
      body.append(ul);
    }
    const cloud = sel.filter((i) => i.onedrive);
    if (cloud.length) line(body, "dc-m-warn", `☁ ${cloud.length} fichier(s) sont dans OneDrive : la suppression sera synchronisée et les retirera aussi de vos autres appareils et du cloud (récupérables 30 jours dans la corbeille OneDrive en ligne).`);
    line(body, perm ? "dc-m-bad" : "dc-m-info", perm ? "⚠ SUPPRESSION DÉFINITIVE : aucun retour possible, la Corbeille est contournée." : "Les fichiers iront dans la Corbeille de Windows (réversible). L'espace n'est libéré qu'au vidage de la Corbeille.");
    let ack = null;
    if (needAck) {
      const lab = document.createElement("label"); lab.className = "dc-ack";
      ack = document.createElement("input"); ack.type = "checkbox";
      lab.append(ack, " Je comprends les risques et je veux supprimer aussi les fichiers 🟠");
      body.append(lab);
    }
    const ok = $("dc-mok");
    ok.disabled = needAck;
    if (ack) ack.onchange = () => (ok.disabled = !ack.checked);
    pending = { ids: sel.map((i) => i.id), perm, risky: needAck };
    $("dc-modal").hidden = false;
    ok.focus();
  }

  async function doDelete() {
    if (!pending) return;
    const p = pending;
    pending = null;
    $("dc-modal").hidden = true;
    $("dc-del").disabled = true;
    try {
      const r = await post("/api/cleaner/delete", { ids: p.ids, permanent: p.perm, allow_risky: p.risky });
      const okIds = new Set(r.results.filter((x) => x.ok).map((x) => x.id));
      const fails = r.results.filter((x) => !x.ok);
      items = items.filter((i) => !okIds.has(i.id));
      okIds.forEach((id) => picked.delete(id));
      renderDisk(r.disk);
      renderAll();
      toast(`${okIds.size} fichier(s) ${p.perm ? "supprimé(s)" : "mis à la Corbeille"} · ${bytes(r.freed)}${fails.length ? " · " + fails.length + " refusé(s) : " + fails[0].message : ""}`, fails.length > 0);
    } catch (e) { toast(e.message, true); updateBar(); }
  }

  function init() {
    if (!$("b-dc")) return;
    $("b-dc").onclick = open;
    $("dc-close").onclick = close;
    $("dc-go").onclick = scan;
    $("dc-stop").onclick = () => post("/api/cleaner/cancel").catch(() => {});
    $("dc-q").oninput = (e) => { fText = e.target.value.trim(); shown = PAGE; renderRows(); };
    $("dc-all").onchange = (e) => {
      visible().slice(0, shown).forEach((i) => { if (i.risk !== "red") e.target.checked ? picked.add(i.id) : picked.delete(i.id); });    // « tout » ne coche jamais un fichier bloqué
      renderRows();
      $("dc-all").checked = e.target.checked;
    };
    $("dc-table").querySelector("th:nth-child(4)").onclick = () => { sortDesc = !sortDesc; renderRows(); };
    $("dc-del").onclick = askDelete;
    $("dc-mcancel").onclick = () => { pending = null; $("dc-modal").hidden = true; };
    $("dc-mok").onclick = doDelete;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !isOpen()) return;
      if (!$("dc-modal").hidden) { pending = null; $("dc-modal").hidden = true; } else close();
    });
  }
  init();
})();
