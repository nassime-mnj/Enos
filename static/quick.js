"use strict";
// OUTILS RAPIDES : (1) formateur / validateur JSON et XML, (2) dépenses partagées, (3) notes de frais (tickets -> Excel). Logique pure : static/quicklib.js (testée sous Node).
(() => {
  const $ = (id) => document.getElementById(id);
  if (!$("qt") || !$("b-qt") || !window.QL) return;
  const Q = window.QL;
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const bytes = (n) => (n < 1024 ? n + " o" : n < 1048576 ? (n / 1024).toFixed(1) + " Ko" : (n / 1048576).toFixed(2) + " Mo");
  let toastT = 0, tab = "json";
  const toast = (m, bad) => { const t = $("qt-toast"); t.textContent = m; t.className = "qt-toast show" + (bad ? " bad" : ""); clearTimeout(toastT); toastT = setTimeout(() => (t.className = "qt-toast"), bad ? 6000 : 3000); };
  async function api(path, opts = {}) {
    const h = { "X-Nasko-Token": TOKEN };
    let body = opts.body;
    if (body !== undefined && !(body instanceof FormData)) { h["Content-Type"] = "application/json"; body = JSON.stringify(body); }
    const r = await fetch(path, { method: opts.method || (body !== undefined ? "POST" : "GET"), headers: h, body });
    if (!r.ok) { let d = r.statusText; try { d = (await r.json()).detail || d; } catch (e) {} throw new Error(typeof d === "string" ? d : "requête refusée"); }
    return r.json();
  }
  const ROLE = (document.body.dataset.role || "none");                          // données du navigateur séparées par profil (un autre profil ne retrouve pas vos dépenses)
  const store = (k, v) => { try { localStorage.setItem("qt." + ROLE + "." + k, JSON.stringify(v)); } catch (e) {} };
  const load = (k, d) => { try { const v = localStorage.getItem("qt." + ROLE + "." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const copy = (txt) => { try { navigator.clipboard.writeText(txt); toast("Copié."); } catch (e) { toast("Copie impossible : sélectionnez le texte.", true); } };

  // ================================================================== 1 · JSON / XML
  const J = { src: "", out: "" };
  let jt = 0;
  const SAMPLE = "{'nom': 'Enos', // commentaire\n 'actif': True, 'tags': ['a','b',], version: 2,}";

  function isXml(t) { return /^\s*(<\?xml|<)/.test(t); }

  function prettyXml(doc, indentStr, declaration) {
    const ind = (n) => indentStr.repeat(n);
    const eT = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const eA = (s) => eT(s).replace(/"/g, "&quot;");
    const node = (n, d) => {
      if (n.nodeType === 8) return ind(d) + `<!--${n.nodeValue}-->\n`;
      if (n.nodeType === 4) return ind(d) + `<![CDATA[${n.nodeValue}]]>\n`;
      if (n.nodeType === 7) return ind(d) + `<?${n.target} ${n.data}?>\n`;
      if (n.nodeType === 3) { const t = n.nodeValue.trim(); return t ? ind(d) + eT(t) + "\n" : ""; }
      if (n.nodeType !== 1) return "";
      const attrs = [...n.attributes].map((a) => ` ${a.name}="${eA(a.value)}"`).join("");
      const kids = [...n.childNodes].filter((c) => !(c.nodeType === 3 && !c.nodeValue.trim()));
      if (!kids.length) return ind(d) + `<${n.nodeName}${attrs}/>\n`;
      if (kids.length === 1 && kids[0].nodeType === 3) return ind(d) + `<${n.nodeName}${attrs}>${eT(kids[0].nodeValue.trim())}</${n.nodeName}>\n`;
      return ind(d) + `<${n.nodeName}${attrs}>\n` + kids.map((c) => node(c, d + 1)).join("") + ind(d) + `</${n.nodeName}>\n`;
    };
    let out = declaration ? declaration + "\n" : "";
    [...doc.childNodes].forEach((c) => { if (c.nodeType !== 10) out += node(c, 0); });
    return out.replace(/\n$/, "");
  }
  function highlightXml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="c">$1</span>')
      .replace(/(&lt;\/?)([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)(\s*\/?&gt;)/g, (m, a, name, attrs, z) => `${a}<span class="t">${name}</span>${attrs.replace(/([\w:.-]+)(=)("[^"]*")/g, '<span class="a">$1</span>$2<span class="s">$3</span>')}${z}`);
  }
  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const bad = doc.getElementsByTagName("parsererror")[0];
    if (!bad) return { ok: true, doc };
    const flat = bad.textContent.replace(/\s+/g, " ");
    const m = /error on line (\d+) at column (\d+):\s*(.*?)\s*(?:Below is a rendering.*)?$/i.exec(flat) || /line (\d+)(?: at column (\d+))?[:,]?\s*(.*)$/i.exec(flat);
    const msg = m ? (m[3] || "").trim() : flat.replace(/^This page contains the following errors:\s*/i, "").trim();
    return { ok: false, error: { message: msg || "XML invalide", line: m ? +m[1] : null, col: m && m[2] ? +m[2] : null } };
  }
  const indentStr = () => ({ 2: "  ", 4: "    ", tab: "\t" }[$("j-indent").value] || "  ");

  function status(html, kind) { const s = $("j-status"); s.innerHTML = html; s.className = "qt-status " + (kind || ""); }
  function selectLine(line) {
    if (!line) return;
    const ta = $("j-in"), lines = ta.value.split("\n"); let a = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) a += lines[i].length + 1;
    ta.focus(); ta.setSelectionRange(a, a + (lines[line - 1] || "").length);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20; ta.scrollTop = Math.max(0, (line - 4) * lh);
  }
  function stats(v) {
    let keys = 0, depth = 0;
    const walk = (x, d) => { depth = Math.max(depth, d); if (Array.isArray(x)) x.forEach((y) => walk(y, d + 1)); else if (x && typeof x === "object") { keys += Object.keys(x).length; Object.values(x).forEach((y) => walk(y, d + 1)); } };
    walk(v, 1); return `${keys} clé${keys > 1 ? "s" : ""} · ${depth} niveau${depth > 1 ? "x" : ""}`;
  }
  function showOut(text, xml) { J.out = text; $("j-out").innerHTML = xml ? highlightXml(text) : Q.highlightJson(text); }

  // action : format | min | sort | repair | check
  function runJson(action) {
    if (!$("j-in")) return;                                            // le minuteur peut se déclencher après un changement d'onglet
    const text = $("j-in").value;
    if (!text.trim()) { J.out = ""; $("j-out").innerHTML = ""; return status("Collez du JSON ou du XML à gauche."); }
    if (isXml(text)) {
      const r = parseXml(text);
      if (!r.ok) { $("j-out").innerHTML = ""; J.out = ""; const where = r.error.line ? `Ligne ${r.error.line}${r.error.col ? ", colonne " + r.error.col : ""} : ` : ""; status(`✗ XML invalide — ${esc(where + r.error.message)}`, "bad"); selectLineIf(action, r.error.line); return; }
      const decl = (/^\s*(<\?xml[^>]*\?>)/.exec(text) || [])[1];
      if (action === "check") { status(`✓ XML valide (élément racine <${esc(r.doc.documentElement.nodeName)}>)`, "good"); return; }
      const out = action === "min" ? text.replace(/>\s+</g, "><").trim() : prettyXml(r.doc, indentStr(), decl);
      showOut(out, true); status(`✓ XML valide · ${out.length} caractères`, "good"); return;
    }
    const r = Q.parseJson(text, action === "repair");
    if (!r.ok) {
      $("j-out").innerHTML = ""; J.out = "";
      const e = r.error, where = e.line ? `Ligne ${e.line}${e.col ? ", colonne " + e.col : ""} : ` : "";
      status(`✗ JSON invalide — ${esc(where + e.message)}${e.repairable ? ' <button class="btn" id="j-fix" style="margin-left:8px">RÉPARER AUTOMATIQUEMENT</button>' : ""}`, "bad");
      if ($("j-fix")) $("j-fix").onclick = () => runJson("repair");
      selectLineIf(action, e.line); return;
    }
    let v = r.value;
    if (action === "sort") v = Q.sortKeys(v);
    const ind = $("j-indent").value === "tab" ? "\t" : +$("j-indent").value;
    const out = action === "min" ? JSON.stringify(v) : JSON.stringify(v, null, ind);
    showOut(out, false);
    status(`✓ ${r.repaired ? "JSON réparé et valide" : "JSON valide"} · ${stats(r.value)} · ${out.length} caractères${r.repaired ? " — corrections : commentaires, virgules finales, guillemets, clés ou valeurs non standard" : ""}`, "good");
  }
  const selectLineIf = (action, line) => { if (action !== "check") selectLine(line); };

  function buildJson() {
    $("qt-main").innerHTML = `<div class="qt-status" id="j-status">Collez du JSON ou du XML à gauche.</div>
      <div class="qt-row"><button class="btn on" id="j-fmt">FORMATER</button><button class="btn" id="j-min">MINIFIER</button><button class="btn" id="j-sort">TRIER LES CLÉS</button><button class="btn" id="j-repair">RÉPARER</button>
        <label>INDENTATION <select id="j-indent"><option value="2">2 espaces</option><option value="4">4 espaces</option><option value="tab">tabulation</option></select></label>
        <span style="flex:1"></span><button class="btn" id="j-sample">EXEMPLE</button><button class="btn" id="j-copy">COPIER LE RÉSULTAT</button><button class="btn" id="j-use">↻ RÉSULTAT → ENTRÉE</button><button class="btn danger" id="j-clear">VIDER</button></div>
      <div class="qt-two"><div><div class="qt-p">ENTRÉE</div><textarea class="qt-code" id="j-in" spellcheck="false" placeholder='{"exemple": [1, 2, 3]}  ou  <racine><a/></racine>'></textarea></div>
        <div><div class="qt-p">RÉSULTAT</div><pre class="qt-out" id="j-out"></pre></div></div>
      <p class="qt-p">Le JSON presque valide (commentaires, virgules en trop, guillemets simples, clés sans guillemets, True / False / None) est détecté : « RÉPARER » le corrige. Tout reste sur ce PC.</p>`;
    $("j-in").value = J.src; $("j-in").oninput = () => { J.src = $("j-in").value; clearTimeout(jt); jt = setTimeout(() => runJson("check"), 300); };
    $("j-fmt").onclick = () => runJson("format"); $("j-min").onclick = () => runJson("min"); $("j-sort").onclick = () => runJson("sort"); $("j-repair").onclick = () => runJson("repair");
    $("j-sample").onclick = () => { $("j-in").value = J.src = SAMPLE; runJson("check"); };
    $("j-copy").onclick = () => J.out ? copy(J.out) : toast("Rien à copier : formatez d'abord.", true);
    $("j-use").onclick = () => { if (!J.out) return; $("j-in").value = J.src = J.out; runJson("check"); };
    $("j-clear").onclick = () => { $("j-in").value = J.src = ""; J.out = ""; $("j-out").innerHTML = ""; status("Collez du JSON ou du XML à gauche."); };
    if (J.src) runJson("check");
  }

  // ================================================================== 2 · DÉPENSES PARTAGÉES
  let D = load("exp", { title: "", cur: "€", people: [], expenses: [] });
  const saveD = () => store("exp", D);
  const uid = () => Math.random().toString(36).slice(2, 8);

  function expData() { return D.expenses.map((e) => ({ label: e.label, amount: Q.toCents(e.amount), payer: e.payer, split: e.split })); }

  function renderExpResult() {
    const people = D.people, ex = expData();
    const bad = ex.filter((e, i) => D.expenses[i].amount !== "" && !(e.amount > 0)).length;
    const b = Q.balances(people, ex), pay = Q.settle(b.balance);
    let h = "";
    if (people.length < 2) h = `<p class="qt-p">Ajoutez au moins deux personnes pour calculer les comptes.</p>`;
    else {
      h = `${bad ? `<div class="qt-warn">${bad} montant${bad > 1 ? "s" : ""} invalide${bad > 1 ? "s" : ""} (ignoré${bad > 1 ? "s" : ""}).</div>` : ""}<table class="qt-tbl"><thead><tr><th>PERSONNE</th><th class="num">A PAYÉ</th><th class="num">DOIT SUPPORTER</th><th class="num">SOLDE</th></tr></thead><tbody>` +
        people.map((p) => `<tr><td>${esc(p)}</td><td class="num">${Q.fmt(b.paid[p], D.cur)}</td><td class="num">${Q.fmt(b.owed[p], D.cur)}</td><td class="num ${b.balance[p] > 0 ? "pos" : b.balance[p] < 0 ? "neg" : ""}">${b.balance[p] > 0 ? "+" : ""}${Q.fmt(b.balance[p], D.cur)}</td></tr>`).join("") +
        `</tbody></table><h4 style="margin:16px 0 8px;color:#a5c76f;letter-spacing:3px;font-size:11px">REMBOURSEMENTS (LE MOINS DE VIREMENTS POSSIBLE)</h4><div class="qt-pay">` +
        (pay.length ? pay.map((t) => `<div><b>${esc(t.from)}</b> doit <b>${Q.fmt(t.amount, D.cur)}</b> à <b>${esc(t.to)}</b></div>`).join("") : `<div>✅ Les comptes sont équilibrés.</div>`) + `</div>`;
    }
    $("x-res").innerHTML = h;
    $("x-msg").value = people.length >= 2 ? Q.summary(D.title, people, ex, D.cur) : "";
  }

  function renderExpForm() {
    const opts = (sel) => D.people.map((p) => `<option ${p === sel ? "selected" : ""}>${esc(p)}</option>`).join("");
    $("x-people").innerHTML = D.people.map((p, i) => `<span class="qt-chip">${esc(p)}<button data-rp="${i}" title="Retirer">✕</button></span>`).join("") || '<span class="qt-p">Aucune personne pour l\'instant.</span>';
    $("x-body").innerHTML = D.expenses.map((e, i) => `<tr data-i="${i}"><td><input type="text" data-f="label" value="${esc(e.label)}" placeholder="Restaurant, essence…"></td>
      <td><input type="text" data-f="amount" value="${esc(e.amount)}" inputmode="decimal" placeholder="0,00" style="width:90px"></td>
      <td><select data-f="payer">${opts(e.payer)}</select></td>
      <td><div class="who">${D.people.map((p) => `<label><input type="checkbox" data-sp="${esc(p)}" ${e.split.includes(p) ? "checked" : ""}>${esc(p)}</label>`).join("")}</div></td>
      <td><button class="btn danger" data-rx="${i}" title="Supprimer">✕</button></td></tr>`).join("");
    $("x-people").querySelectorAll("[data-rp]").forEach((b) => (b.onclick = () => { const p = D.people[+b.dataset.rp]; D.people.splice(+b.dataset.rp, 1); D.expenses.forEach((e) => { e.split = e.split.filter((x) => x !== p); if (e.payer === p) e.payer = D.people[0] || ""; }); saveD(); renderExpForm(); }));
    $("x-body").querySelectorAll("tr").forEach((tr) => {
      const e = D.expenses[+tr.dataset.i];
      tr.querySelectorAll("[data-f]").forEach((el) => (el.oninput = el.onchange = () => { e[el.dataset.f] = el.value; saveD(); renderExpResult(); }));
      tr.querySelectorAll("[data-sp]").forEach((el) => (el.onchange = () => { e.split = el.checked ? [...new Set([...e.split, el.dataset.sp])] : e.split.filter((x) => x !== el.dataset.sp); saveD(); renderExpResult(); }));
      tr.querySelector("[data-rx]").onclick = () => { D.expenses.splice(+tr.dataset.i, 1); saveD(); renderExpForm(); };
    });
    renderExpResult();
  }

  function buildExp() {
    $("qt-main").innerHTML = `<div class="qt-card"><h4>1 · QUI ÉTAIT LÀ ?</h4><div class="qt-row"><input type="text" id="x-title" placeholder="Nom de l'événement (ex. Week-end à Lyon)" style="flex:1;min-width:220px" maxlength="60">
        <label>MONNAIE <select id="x-cur"><option>€</option><option>$</option><option>£</option><option>CHF</option></select></label></div>
      <form class="qt-row" id="x-form"><input type="text" id="x-name" placeholder="Prénom puis Entrée" maxlength="30" autocomplete="off"><button class="btn on" type="submit">+ AJOUTER</button></form><div class="qt-chips" id="x-people"></div></div>
      <div class="qt-card"><h4>2 · LES DÉPENSES</h4><table class="qt-tbl"><thead><tr><th>DÉPENSE</th><th>MONTANT</th><th>PAYÉ PAR</th><th>PARTAGÉ ENTRE</th><th></th></tr></thead><tbody id="x-body"></tbody></table>
        <div class="qt-row"><button class="btn on" id="x-add">+ AJOUTER UNE DÉPENSE</button><span class="qt-p" style="margin:0">La part de chacun est égale ; le reste en centimes est réparti sans perte.</span></div></div>
      <div class="qt-card"><h4>3 · QUI DOIT QUOI À QUI</h4><div id="x-res"></div></div>
      <div class="qt-card"><h4>4 · MESSAGE À ENVOYER</h4><textarea class="qt-msg" id="x-msg" readonly></textarea><div class="qt-row"><button class="btn on" id="x-copy">COPIER LE MESSAGE</button><button class="btn danger" id="x-reset">TOUT EFFACER</button></div></div>`;
    $("x-title").value = D.title; $("x-cur").value = D.cur;
    $("x-title").oninput = () => { D.title = $("x-title").value; saveD(); renderExpResult(); };
    $("x-cur").onchange = () => { D.cur = $("x-cur").value; saveD(); renderExpResult(); };
    $("x-form").onsubmit = (e) => {
      e.preventDefault(); const n = $("x-name").value.trim().replace(/\s+/g, " ");
      if (!n) return;
      if (D.people.some((p) => p.toLowerCase() === n.toLowerCase())) return toast("Ce prénom existe déjà : ajoutez un détail (ex. « Marie L. »).", true);
      D.people.push(n); D.expenses.forEach((x) => { if (x.autoAll) x.split.push(n); if (!x.payer) x.payer = n; }); $("x-name").value = ""; saveD(); renderExpForm(); $("x-name").focus();
    };
    $("x-add").onclick = () => { if (!D.people.length) return toast("Ajoutez d'abord les personnes.", true); D.expenses.push({ id: uid(), label: "", amount: "", payer: D.people[0], split: [...D.people], autoAll: true }); saveD(); renderExpForm(); };
    $("x-copy").onclick = () => ($("x-msg").value ? copy($("x-msg").value) : toast("Ajoutez des personnes et des dépenses.", true));
    $("x-reset").onclick = () => { if (!confirm("Tout effacer (personnes et dépenses) ?")) return; D = { title: "", cur: "€", people: [], expenses: [] }; saveD(); buildExp(); };
    renderExpForm();
  }

  // ================================================================== 3 · NOTES DE FRAIS
  let N = { rows: [], busy: false };
  const CATS = ["Restauration", "Transport", "Hébergement", "Carburant", "Fournitures", "Télécom", "Autre"];

  function buildRc(msg) {
    $("qt-main").innerHTML = `${msg ? `<div class="qt-warn err">${esc(msg)}</div>` : ""}<div class="qt-card"><h4>TICKETS ET FACTURES</h4><div class="qt-dz" id="n-dz"><b>DÉPOSEZ VOS PHOTOS DE TICKETS ICI</b><small>JPG, PNG, HEIC (iPhone) ou PDF — jusqu'à 60 à la fois</small></div>
      <p class="qt-p">Le modèle de vision du LLM configuré lit chaque ticket (date, commerçant, montant TTC, TVA). <b>Vérifiez toujours</b> le tableau avant d'exporter : les lignes douteuses sont signalées. Les photos sont envoyées au LLM pour lecture puis supprimées.</p></div>
      <div id="n-table"></div>`;
    const dz = $("n-dz");
    dz.onclick = () => { $("qt-file").accept = ".jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.heic,.heif,.avif,.pdf"; $("qt-file").multiple = true; $("qt-file").onchange = (e) => { const f = [...e.target.files]; e.target.value = ""; analyzeRc(f); }; $("qt-file").click(); };
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
    dz.addEventListener("drop", (e) => analyzeRc([...e.dataTransfer.files]));
    renderRcTable();
  }

  async function analyzeRc(files) {
    if (!files.length || N.busy) return;
    N.busy = true;
    $("qt-main").innerHTML = `<div class="qt-job"><b>LECTURE DES TICKETS</b><small id="n-stage">${files.length} fichier${files.length > 1 ? "s" : ""}…</small><div class="qt-bar"><i id="n-bar"></i></div></div>`;
    try {
      const fd = new FormData(); files.forEach((f) => fd.append("files", f, f.name));
      let j = await api("/api/receipts/analyze", { body: fd });
      while (j.busy) { await wait(500); j = await api("/api/receipts/job"); $("n-stage").textContent = j.stage || ""; $("n-bar").style.width = Math.max(3, j.progress) + "%"; }
      N.busy = false;
      if (j.error) return buildRc(j.error);
      N.rows = N.rows.concat(j.result.rows.map((r) => ({ ...r, total: r.total == null ? "" : String(r.total).replace(".", ","), vat: r.vat == null ? "" : String(r.vat).replace(".", ",") })));
      buildRc();
    } catch (e) { N.busy = false; buildRc(e.message); }
  }

  const nNum = (v) => { const c = Q.toCents(v); return Number.isNaN(c) ? null : c / 100; };
  function renderRcTable() {
    const box = $("n-table"); if (!box) return;
    if (!N.rows.length) { box.innerHTML = ""; return; }
    const tot = N.rows.reduce((s, r) => s + (nNum(r.total) || 0), 0), vat = N.rows.reduce((s, r) => s + (nNum(r.vat) || 0), 0), w = N.rows.filter((r) => (r.warn || []).length).length;
    box.innerHTML = `<div class="qt-card"><h4>À VÉRIFIER (${N.rows.length} LIGNE${N.rows.length > 1 ? "S" : ""}${w ? ` · ${w} DOUTEUSE${w > 1 ? "S" : ""}` : ""})</h4><div style="overflow:auto"><table class="qt-tbl"><thead><tr><th>DATE</th><th>COMMERÇANT</th><th>CATÉGORIE</th><th>N° FACTURE</th><th>TOTAL TTC</th><th>TVA</th><th></th></tr></thead><tbody>` +
      N.rows.map((r, i) => `<tr class="${(r.warn || []).length ? "warn" : ""}" data-i="${i}"><td><input type="date" data-f="date" value="${esc(r.date)}"></td><td><input type="text" data-f="merchant" value="${esc(r.merchant)}"><span class="w">${esc((r.warn || []).join(" "))}</span><span class="w" style="color:var(--mu)">${esc(r.file)}</span></td>
        <td><select data-f="category">${CATS.map((c) => `<option ${c === r.category ? "selected" : ""}>${c}</option>`).join("")}</select></td><td><input type="text" data-f="invoice" value="${esc(r.invoice)}"></td>
        <td><input type="text" data-f="total" value="${esc(r.total)}" inputmode="decimal" style="width:90px"></td><td><input type="text" data-f="vat" value="${esc(r.vat)}" inputmode="decimal" style="width:80px"></td><td><button class="btn danger" data-rm="${i}">✕</button></td></tr>`).join("") +
      `</tbody></table></div><div class="qt-row"><b>Total : ${tot.toFixed(2).replace(".", ",")} ${esc(N.rows[0].currency || "€")}</b><span class="qt-p" style="margin:0">dont TVA ${vat.toFixed(2).replace(".", ",")}</span><span style="flex:1"></span>
        <button class="btn" id="n-addrow">+ LIGNE MANUELLE</button><button class="btn" id="n-clear">TOUT VIDER</button><button class="btn on" id="n-export">EXPORTER EN EXCEL</button></div><div id="n-done"></div></div>`;
    box.querySelectorAll("tr[data-i]").forEach((tr) => {
      const r = N.rows[+tr.dataset.i];
      tr.querySelectorAll("[data-f]").forEach((el) => (el.oninput = el.onchange = () => { r[el.dataset.f] = el.value; if (el.dataset.f === "total" || el.dataset.f === "vat") { r.warn = []; } }));
      tr.querySelector("[data-rm]").onclick = () => { N.rows.splice(+tr.dataset.i, 1); renderRcTable(); };
      tr.querySelectorAll('[data-f=total],[data-f=vat]').forEach((el) => (el.onchange = () => { r[el.dataset.f] = el.value; setTimeout(renderRcTable, 0); }));
    });
    $("n-addrow").onclick = () => { N.rows.push({ file: "saisie manuelle", date: "", merchant: "", category: "Autre", invoice: "", total: "", vat: "", currency: "EUR", warn: [] }); renderRcTable(); };
    $("n-clear").onclick = () => { if (confirm("Vider le tableau ?")) { N.rows = []; renderRcTable(); } };
    $("n-export").onclick = async () => {
      const bad = N.rows.filter((r) => nNum(r.total) == null || nNum(r.total) <= 0).length;
      if (bad && !confirm(`${bad} ligne${bad > 1 ? "s ont" : " a"} un total vide ou invalide. Exporter quand même ?`)) return;
      try {
        const f = await api("/api/receipts/export", { body: { rows: N.rows.map((r) => ({ ...r, total: nNum(r.total), vat: nNum(r.vat) })) } });
        $("n-done").innerHTML = `<p class="qt-ok" style="margin:10px 0 6px">✓ Classeur créé (feuilles « Notes de frais » et « Synthèse » : totaux en formules).</p><a class="btn on" style="display:inline-block;text-decoration:none" href="${esc(f.link)}" download="${esc(f.name)}">⬇ ${esc(f.name)} (${bytes(f.size)})</a> <button class="btn" id="n-open">OUVRIR LE DOSSIER</button>`;
        $("n-open").onclick = () => api("/api/receipts/open-folder", { body: {} }).catch((e) => toast(e.message, true));
      } catch (e) { toast(e.message, true); }
    };
  }

  // ================================================================== navigation
  function show(t) {
    if (N.busy) return;
    if (t === "rc" && ROLE !== "ceo") t = "json";                                  // Notes de frais : profil CEO uniquement (le serveur refuse aussi)
    clearTimeout(jt); tab = t;
    document.querySelectorAll("#qt-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    if (t === "json") buildJson(); else if (t === "exp") buildExp(); else buildRc();
  }
  const open = () => { $("qt").hidden = false; document.body.classList.remove("menu-open"); show(tab); };
  $("b-qt").onclick = open;
  $("qt-close").onclick = () => { if (!N.busy) $("qt").hidden = true; };
  document.querySelectorAll("#qt-tabs button").forEach((b) => (b.onclick = () => show(b.dataset.t)));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("qt").hidden && !N.busy && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) $("qt").hidden = true; });
})();
