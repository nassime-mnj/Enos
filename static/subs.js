"use strict";
// GESTIONNAIRE D'ABONNEMENTS : totaux mensuel / annuel, une carte par abonnement (statut, prix, compte à rebours), « Gérer / Annuler » (lien de résiliation ou modèle d'e-mail).
// PC et téléphone (même page, zones tactiles ≥ 44 px). Boîtes mail et scan : réservés au PC (.local-only). Tout texte venant des e-mails passe par esc() / textContent ; seuls les liens http(s) sont ouverts.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TOKEN = () => (document.querySelector('meta[name="nasko-token"]') || {}).content || "";
  const FREQ = { monthly: "/ mois", yearly: "/ an", weekly: "/ semaine", one_time: "une fois", unknown: "" };
  const STATUS = { active: ["ACTIF", "ok"], trial: ["ESSAI", "warn"], dormant: ["INACTIF ?", "mute"], cancelled: ["RÉSILIÉ", "mute"] };
  const FILTERS = [["live", "Actifs"], ["trial", "Essais"], ["ended", "Terminés"], ["hidden", "Masqués"], ["all", "Tous"]];
  let data = null, filter = "live", poll = 0, toastT = 0, showBoxes = false;

  async function api(path, opts = {}) {
    const h = { "X-Nasko-Token": TOKEN() };
    let body = opts.body;
    if (body !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(body); }
    const r = await fetch(path, { method: opts.method || (body !== undefined ? "POST" : "GET"), headers: h, body });
    if (!r.ok) { let d = r.statusText; try { d = (await r.json()).detail || d; } catch (e) {} throw new Error(typeof d === "string" ? d : "requête refusée"); }
    return r.json();
  }
  const money = (v, cur) => { try { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur || "EUR" }).format(v); } catch (e) { return v.toFixed(2) + " " + (cur || ""); } };
  const safeUrl = (u) => (/^https?:\/\/\S+$/.test(u || "") ? u : "");
  function toast(m) { const t = $("sb-toast"); t.textContent = m; t.className = "sb-toast show"; clearTimeout(toastT); toastT = setTimeout(() => (t.className = "sb-toast"), 4500); }
  function countdown(s) {
    if (s.status === "cancelled") return "Résilié";
    if (s.days == null) return s.status === "trial" ? "Fin d'essai : date inconnue" : "Date inconnue";
    if (s.days < 0) return "Prélèvement dépassé de " + -s.days + " j";
    if (s.days === 0) return "Prélèvement aujourd'hui";
    if (s.days === 1) return "Prélèvement demain";
    return "Prélèvement dans " + s.days + " j";
  }
  const inView = (f, s) => f === "all" ? true : f === "hidden" ? s.hidden : s.hidden ? false : f === "live" ? s.status === "active" || s.status === "dormant" : f === "trial" ? s.status === "trial" : s.status === "cancelled";

  function build() {
    if ($("sb")) return;
    const s = document.createElement("section");
    s.id = "sb"; s.hidden = true; s.setAttribute("role", "dialog"); s.setAttribute("aria-label", "Gestionnaire d'abonnements");
    s.innerHTML = `<div class="sb-top"><h2>ABONNEMENTS<small>Détectés dans vos e-mails · analysés par l'IA</small></h2><button class="sb-b" id="sb-close" type="button">✕ FERMER</button></div>
      <div class="sb-main" id="sb-main">
        <div class="sb-sum" id="sb-sum" aria-live="polite"></div>
        <div class="sb-acts"><button class="sb-b pri big local-only" id="sb-scan" type="button">⟳ SCANNER MES BOÎTES MAIL</button><button class="sb-b big local-only" id="sb-boxes" type="button">✉ MES BOÎTES</button></div>
        <div class="sb-prog" id="sb-prog" hidden><b id="sb-stage">Analyse…</b><div class="sb-bar"><i id="sb-bar"></i></div></div>
        <div class="sb-warn" id="sb-info" hidden></div>
        <div class="sb-box local-only" id="sb-boxpanel" hidden></div>
        <div class="sb-chips" id="sb-chips" role="tablist"></div>
        <div class="sb-list" id="sb-list"></div>
      </div><div class="sb-toast" id="sb-toast" role="status"></div><div class="sb-sheet" id="sb-sheet" hidden></div>`;
    document.body.appendChild(s);
    $("sb-close").onclick = close;
    $("sb-scan").onclick = scan;
    $("sb-boxes").onclick = () => { showBoxes = !showBoxes; renderBoxes(); };
    $("sb-chips").onclick = (e) => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; render(); } };
    $("sb-list").onclick = (e) => { const b = e.target.closest("[data-m]"); if (b) manage(b.dataset.m); };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !s.hidden) { if (!$("sb-sheet").hidden) closeSheet(); else close(); } });
  }

  function render() {
    if (!data) return;
    const tot = Object.entries(data.totals);
    $("sb-sum").innerHTML = tot.length ? tot.map(([cur, t]) => `<div class="sb-tile"><small>PAR MOIS</small><b>${esc(money(t.monthly, cur))}</b></div><div class="sb-tile"><small>PAR AN</small><b>${esc(money(t.yearly, cur))}</b></div>`).join("")
      : `<div class="sb-tile"><small>PAR MOIS</small><b>—</b></div><div class="sb-tile"><small>PAR AN</small><b>—</b></div>`;
    const live = data.subs.filter((s) => !s.hidden && s.status === "active").length;
    $("sb-sum").insertAdjacentHTML("beforeend", `<div class="sb-tile sm"><small>ACTIFS</small><b>${live}</b></div>`);
    $("sb-chips").innerHTML = FILTERS.map(([k, n]) => `<button type="button" class="sb-chip${filter === k ? " on" : ""}" data-f="${k}" role="tab" aria-selected="${filter === k}">${n} <i>${data.subs.filter((s) => inView(k, s)).length}</i></button>`).join("");
    const list = data.subs.filter((s) => inView(filter, s));
    $("sb-list").innerHTML = list.length ? list.map(card).join("") : `<div class="sb-empty">${data.subs.length ? "Aucun abonnement dans cette vue." : "Aucun abonnement détecté pour l'instant.<br><span>Ajoutez une boîte mail puis lancez un scan depuis le PC.</span>"}</div>`;
    renderBoxes();
  }

  function card(s) {
    const [lab, cls] = STATUS[s.status] || ["?", "mute"];
    const price = s.price != null ? `${esc(money(s.price, s.currency))} <small>${FREQ[s.frequency] || ""}</small>` : `<small>prix non détecté</small>`;
    const urgent = s.days != null && s.days >= 0 && s.days <= 3 && s.status !== "cancelled" ? " urgent" : "";
    return `<article class="sb-card ${cls}${urgent}${s.hidden ? " hid" : ""}"><div class="sb-row"><h3>${esc(s.service)}</h3><span class="sb-st ${cls}">${lab}</span></div>
      <div class="sb-price">${price}</div>
      <div class="sb-when${urgent}">${esc(countdown(s))}${s.next ? ` <small>· ${esc(new Date(s.next + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }))}</small>` : ""}</div>
      <div class="sb-meta">${s.emails} e-mail${s.emails > 1 ? "s" : ""} · ${esc(s.boxes.join(", "))}</div>
      <button class="sb-b pri wide" type="button" data-m="${esc(s.key)}">GÉRER / ANNULER</button></article>`;
  }

  async function refresh() {
    try { data = await api("/api/subs/list"); render(); } catch (e) { $("sb-list").innerHTML = `<div class="sb-warn err">${esc(e.message)}</div>`; }
  }

  // ------------------------------------------------------------------ scan (PC)
  async function scan() {
    $("sb-info").hidden = true;
    try { await api("/api/subs/scan", { body: {} }); } catch (e) { return toast(e.message); }
    watch();
  }
  function watch() {
    $("sb-scan").disabled = true; $("sb-prog").hidden = false;
    clearInterval(poll);
    poll = setInterval(async () => {
      let j; try { j = await api("/api/subs/job"); } catch (e) { return; }
      $("sb-stage").textContent = j.label || "Analyse…"; $("sb-bar").style.width = (j.pct || 0) + "%";
      if (j.busy) return;
      clearInterval(poll); $("sb-scan").disabled = false; $("sb-prog").hidden = true;
      const st = j.stats, box = $("sb-info");
      if (j.error) { box.className = "sb-warn err"; box.textContent = j.error; box.hidden = false; }
      else if (st) {
        const bits = [`${st.analyzed} e-mail${st.analyzed > 1 ? "s" : ""} analysé${st.analyzed > 1 ? "s" : ""}`, `${st.subs} abonnement${st.subs > 1 ? "s" : ""} repéré${st.subs > 1 ? "s" : ""}`];
        if (st.left) bits.push(`${st.left} restant${st.left > 1 ? "s" : ""} : relancez le scan pour continuer`);
        box.className = "sb-warn" + (st.errors.length ? " err" : ""); box.textContent = bits.join(" · ") + (st.errors.length ? " — " + st.errors.join(" | ") : ""); box.hidden = false;
      }
      refresh();
    }, 1500);
  }

  // ------------------------------------------------------------------ boîtes mail (PC)
  async function renderBoxes() {
    const p = $("sb-boxpanel"); p.hidden = !showBoxes;
    if (!showBoxes) return;
    let accs = (data && data.accounts) || [];
    p.innerHTML = `<h3>BOÎTES MAIL</h3><p class="sb-hint">Lecture seule. Utilisez un <b>mot de passe d'application</b> (Gmail : Compte Google → Sécurité → Mots de passe des applications). Il est chiffré sur ce PC (Windows DPAPI) et n'est jamais affiché ni envoyé ailleurs qu'à votre serveur IMAP.</p>
      <div id="sb-acc-list">${accs.length ? accs.map((a) => `<div class="sb-acc"><span><b>${esc(a.email)}</b><small>${esc(a.server)}:${a.port}${a.last_scan ? " · scanné " + esc(new Date(a.last_scan * 1000).toLocaleDateString("fr-FR")) : " · jamais scanné"}</small></span><button class="sb-b" type="button" data-del="${esc(a.id)}" aria-label="Retirer ${esc(a.email)}">RETIRER</button></div>`).join("") : '<div class="sb-hint">Aucune boîte enregistrée.</div>'}</div>
      <form id="sb-form" autocomplete="off"><input type="email" id="sb-email" placeholder="Adresse e-mail" required autocomplete="off" inputmode="email"><input type="password" id="sb-pw" placeholder="Mot de passe d'application" required autocomplete="new-password">
      <div class="sb-two"><input type="text" id="sb-srv" placeholder="Serveur IMAP (auto : imap.gmail.com…)" spellcheck="false"><input type="number" id="sb-port" value="993" min="1" max="65535" aria-label="Port"></div>
      <button class="sb-b pri big wide" type="submit">TESTER ET AJOUTER</button><p class="sb-err" id="sb-err" role="alert" hidden></p></form>`;
    p.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      if (!confirm("Retirer cette boîte et ses analyses du cache ?")) return;
      try { await api("/api/subs/accounts/" + encodeURIComponent(b.dataset.del), { method: "DELETE" }); await refresh(); } catch (e) { toast(e.message); }
    }));
    $("sb-form").onsubmit = async (e) => {
      e.preventDefault(); const err = $("sb-err"), btn = e.submitter; err.hidden = true; btn.disabled = true; btn.textContent = "CONNEXION…";
      try {
        await api("/api/subs/accounts", { body: { email: $("sb-email").value.trim(), password: $("sb-pw").value, server: $("sb-srv").value.trim(), port: +$("sb-port").value || 993 } });
        $("sb-pw").value = ""; toast("Boîte ajoutée. Lancez un scan."); await refresh();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = "TESTER ET AJOUTER"; }
    };
  }

  // ------------------------------------------------------------------ Gérer / Annuler
  function closeSheet() { const s = $("sb-sheet"); s.hidden = true; s.innerHTML = ""; }
  async function manage(key) {
    const sub = data.subs.find((x) => x.key === key); if (!sub) return;
    let c; try { c = await api("/api/subs/cancel/" + encodeURIComponent(key)); } catch (e) { return toast(e.message); }
    const url = safeUrl(c.url), m = c.mail, sh = $("sb-sheet");
    sh.innerHTML = `<div class="sb-card-sheet" role="dialog" aria-label="Résilier ${esc(c.service)}"><div class="sb-row"><h3>${esc(c.service)}</h3><button class="sb-b" type="button" id="sb-sh-x" aria-label="Fermer">✕</button></div>
      ${url ? `<a class="sb-b pri big wide sb-link" id="sb-open" href="${esc(url)}" target="_blank" rel="noopener noreferrer">OUVRIR LA PAGE DE RÉSILIATION ↗</a><div class="sb-url">${esc(url)}</div>` : '<div class="sb-warn">Aucun lien de résiliation trouvé dans vos e-mails.</div>'}
      ${c.method ? `<div class="sb-hint"><b>Méthode indiquée :</b> ${esc(c.method)}</div>` : ""}
      <h4>MODÈLE D'E-MAIL DE RÉSILIATION</h4><p class="sb-hint">E.N.O.S. n'envoie rien : copiez ce modèle ou ouvrez-le dans votre application de messagerie, relisez-le, ajoutez votre nom puis envoyez-le vous-même.</p>
      <label class="sb-lab">À<input type="text" id="sb-to" value="${esc(m.to)}" placeholder="adresse du service (à compléter)"></label>
      <label class="sb-lab">Objet<input type="text" id="sb-subj" value="${esc(m.subject)}"></label>
      <textarea id="sb-body" rows="9" aria-label="Corps de l'e-mail">${esc(m.body)}</textarea>
      <div class="sb-two"><button class="sb-b big" type="button" id="sb-copy">COPIER LE MODÈLE</button><a class="sb-b big sb-link" id="sb-mail" href="#">OUVRIR MON E-MAIL</a></div>
      <div class="sb-two"><button class="sb-b big" type="button" id="sb-done">${sub.status === "cancelled" ? "REMETTRE EN ACTIF" : "J'AI RÉSILIÉ"}</button><button class="sb-b big" type="button" id="sb-hide">${sub.hidden ? "AFFICHER" : "MASQUER"}</button></div></div>`;
    sh.hidden = false;
    const mailto = () => "mailto:" + encodeURIComponent($("sb-to").value.trim()) + "?subject=" + encodeURIComponent($("sb-subj").value) + "&body=" + encodeURIComponent($("sb-body").value);
    $("sb-mail").onclick = (e) => { e.preventDefault(); location.href = mailto(); };
    $("sb-sh-x").onclick = closeSheet;
    sh.onclick = (e) => { if (e.target === sh) closeSheet(); };
    $("sb-copy").onclick = async () => {
      const txt = "À : " + $("sb-to").value + "\nObjet : " + $("sb-subj").value + "\n\n" + $("sb-body").value;
      try { await navigator.clipboard.writeText(txt); toast("Modèle copié."); } catch (e) { $("sb-body").select(); toast("Sélectionné : copiez-le à la main."); }
    };
    $("sb-done").onclick = async () => { try { await api("/api/subs/state/" + encodeURIComponent(key), { body: { cancelled: sub.status !== "cancelled" } }); closeSheet(); refresh(); } catch (e) { toast(e.message); } };
    $("sb-hide").onclick = async () => { try { await api("/api/subs/state/" + encodeURIComponent(key), { body: { hidden: !sub.hidden } }); closeSheet(); refresh(); } catch (e) { toast(e.message); } };
  }

  function open() {
    build(); $("sb").hidden = false;
    if (window.enosOS && window.enosOS.closeLauncher) window.enosOS.closeLauncher();
    refresh();
    api("/api/subs/job").then((j) => { if (j.busy) watch(); }).catch(() => {});             // scan déjà en cours (ouvert depuis un autre écran) : on reprend l'affichage
  }
  function close() { const s = $("sb"); if (s) s.hidden = true; clearInterval(poll); }
  window.enosSubs = { open, close };
  const wire = () => { const b = $("b-subs"); if (b) b.onclick = open; };
  document.addEventListener("DOMContentLoaded", wire);
  if (document.readyState !== "loading") wire();
})();
