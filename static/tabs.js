"use strict";
// GESTION GOOGLE : tableau de bord des onglets Chrome (CDP). Liste rapide + miniatures paresseuses (cartes visibles seulement).
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { "X-Nasko-Token": TOKEN, "Content-Type": "application/json" } });
    if (!r.ok) {
      let d = r.statusText;
      try { d = (await r.json()).detail || d; } catch (e) {}
      throw new Error(typeof d === "string" ? d : "requête refusée");
    }
    return r.json();
  }
  const CONCURRENCY = 2;                      // captures simultanées : Chrome n'est jamais submergé
  const REFRESH_MS = 5000;                    // synchronisation de la liste (léger : aucune capture)
  let tabs = new Map(), order = [], filter = "", obs = null, queue = [], active = 0, pollT = 0, loading = false, toastT;

  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const isOpen = () => !$("tb").hidden;
  function toast(msg, bad) {
    const t = $("tb-toast"); t.textContent = msg; t.className = "tb-toast show" + (bad ? " bad" : "");
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = "tb-toast"), 3500);
  }

  // ---------------------------------------------------------------- liste
  async function refresh(first) {
    if (loading) return;
    loading = true;
    let r;
    try { r = await api("/api/tabs"); } catch (e) { loading = false; return showError(e.message); }
    loading = false;
    if (!r.ok) return showError(r.message, r.code, r.chrome_running);
    $("tb-err").hidden = true; $("tb-grid").hidden = false;
    const seen = new Set();
    r.tabs.forEach((t) => {
      seen.add(t.id);
      const old = tabs.get(t.id);
      tabs.set(t.id, { ...t, thumb: t.thumb || (old && old.thumb) || null, failed: old && old.failed && old.url === t.url });
      if (old && (old.title !== t.title || old.url !== t.url)) updateCard(t.id);
    });
    // onglets fermés ailleurs (dans Chrome) : leurs cartes disparaissent
    [...tabs.keys()].filter((id) => !seen.has(id)).forEach((id) => { tabs.delete(id); removeCard(id); });
    order = r.tabs.map((t) => t.id);
    syncGrid();
    if (first) $("tb-grid").scrollTop = 0;
  }

  function showError(msg, code, running) {
    $("tb-grid").hidden = true; $("tb-err").hidden = false;
    $("tb-err-t").textContent = code === "no_cdp" ? (running ? "CHROME OUVERT · NON PILOTABLE" : "AUCUN CHROME OUVERT") : "ERREUR";
    $("tb-err-m").textContent = msg || "";
    $("tb-launch").hidden = code !== "no_cdp";
    $("tb-ext").hidden = code !== "no_cdp";
    $("tb-hint").hidden = code !== "no_cdp";
    $("tb-count").textContent = "";
  }

  // ---------------------------------------------------------------- grille
  function cardEl(t) {
    const c = document.createElement("article");
    c.className = "tb-card"; c.dataset.id = t.id;
    c.innerHTML = `
      <div class="th"><div class="ph" style="--h:${hue(t.host)}"><b>${esc((t.host[0] || "?").toUpperCase())}</b></div><img alt="" draggable="false"><span class="sk"></span>
        <em class="host">${esc(t.host || "—")}</em>${t.internal ? '<em class="sys">SYSTÈME</em>' : ""}</div>
      <div class="ti"><h4 title="${esc(t.title)}">${esc(t.title)}</h4><small title="${esc(t.url)}">${esc(t.url)}</small></div>
      <button class="x" type="button">FERMER L'ONGLET</button>`;
    c.querySelector(".x").onclick = () => closeTab(t.id, c);
    return c;
  }

  function updateCard(id) {
    const t = tabs.get(id), c = document.querySelector(`.tb-card[data-id="${CSS.escape(id)}"]`);
    if (!t || !c) return;
    const h = c.querySelector("h4"), s = c.querySelector("small");
    h.textContent = t.title; h.title = t.title; s.textContent = t.url; s.title = t.url;
    c.querySelector(".host").textContent = t.host || "—";
  }

  function removeCard(id) {
    const c = document.querySelector(`.tb-card[data-id="${CSS.escape(id)}"]`);
    if (!c) return;
    if (obs) obs.unobserve(c);
    c.classList.add("out");                                       // fondu + réduction, puis retrait du DOM
    setTimeout(() => { c.remove(); count(); }, 380);
  }

  const matches = (t) => !filter || (t.title + " " + t.url).toLowerCase().includes(filter);

  function syncGrid() {
    const grid = $("tb-grid");
    const have = new Map([...grid.querySelectorAll(".tb-card:not(.out)")].map((c) => [c.dataset.id, c]));
    let prev = null, i = 0;
    order.forEach((id) => {
      const t = tabs.get(id);
      let c = have.get(id);
      if (!c) { c = cardEl(t); c.style.animationDelay = Math.min(i++, 12) * 40 + "ms"; if (obs) obs.observe(c); }
      c.hidden = !matches(t);
      if (t.thumb) applyThumb(c, t.thumb);
      if (c.parentNode !== grid || c.previousElementSibling !== prev) grid.insertBefore(c, prev ? prev.nextSibling : grid.firstChild);   // respecte l'ordre de Chrome
      prev = c;
    });
    count();
  }

  function count() {
    const n = order.filter((id) => tabs.has(id) && matches(tabs.get(id))).length;
    $("tb-count").textContent = filter ? `${n} / ${tabs.size} onglets` : `${tabs.size} onglet${tabs.size > 1 ? "s" : ""}`;
    $("tb-none").hidden = n > 0 || tabs.size === 0 ? true : false;
    $("tb-none").hidden = !(n === 0 && tabs.size > 0);
  }

  // ---------------------------------------------------------------- miniatures paresseuses
  function applyThumb(c, data) {
    const img = c.querySelector("img");
    if (img.dataset.done === "1") return;
    img.onload = () => c.classList.add("has"); img.src = data; img.dataset.done = "1"; c.classList.remove("loading");
  }

  function want(c) {                                              // carte devenue visible : on met sa miniature en file
    const id = c.dataset.id, t = tabs.get(id);
    if (!t || t.thumb || t.failed || t.queued) return;
    t.queued = true; c.classList.add("loading"); queue.push(id); pump();
  }

  async function pump() {
    while (active < CONCURRENCY && queue.length) {
      const id = queue.shift(), t = tabs.get(id);
      if (!t) continue;
      active++;
      (async () => {
        try {
          const r = await api("/api/tabs/thumb?id=" + encodeURIComponent(id));
          const cur = tabs.get(id), c = document.querySelector(`.tb-card[data-id="${CSS.escape(id)}"]`);
          if (cur) { cur.queued = false; if (r.ok) { cur.thumb = r.thumb; if (c) applyThumb(c, r.thumb); } else { cur.failed = true; if (c) c.classList.remove("loading"); c && c.classList.add("nothumb"); } }
        } catch (e) { const cur = tabs.get(id); if (cur) cur.queued = false; }
        finally { active--; pump(); }
      })();
    }
  }

  // ---------------------------------------------------------------- fermeture
  async function closeTab(id, card) {
    const btn = card.querySelector(".x");
    btn.disabled = true; btn.textContent = "FERMETURE…";
    try {
      const r = await api("/api/tabs/close", { method: "POST", body: JSON.stringify({ id }) });
      if (!r.ok) throw new Error(r.message || "fermeture impossible");
      tabs.delete(id); order = order.filter((x) => x !== id);
      removeCard(id);                                               // la carte disparaît immédiatement
      toast("Onglet fermé");
    } catch (e) {
      btn.disabled = false; btn.textContent = "FERMER L'ONGLET"; card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
      toast(e.message, true);
      refresh();                                                    // l'onglet n'existe peut-être plus : on resynchronise
    }
  }

  // ---------------------------------------------------------------- ouverture
  function open() {
    $("tb").hidden = false; document.body.classList.remove("menu-open");
    obs = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && want(e.target)), { root: $("tb-grid"), rootMargin: "150px" });
    $("tb-grid").querySelectorAll(".tb-card").forEach((c) => obs.observe(c));
    refresh(true);
    clearInterval(pollT);
    pollT = setInterval(() => { if (isOpen() && !document.hidden) refresh(); }, REFRESH_MS);
  }
  function close() { $("tb").hidden = true; clearInterval(pollT); if (obs) obs.disconnect(); queue = []; tabs.forEach((t) => (t.queued = false)); }

  function init() {
    if (!$("b-tb")) return;
    $("b-tb").onclick = open;
    $("tb-close").onclick = close;
    $("tb-refresh").onclick = () => { tabs.forEach((t) => { t.thumb = null; t.failed = false; t.queued = false; }); $("tb-grid").querySelectorAll("img").forEach((i) => { i.removeAttribute("src"); i.dataset.done = ""; i.parentElement.parentElement.classList.remove("has", "nothumb"); }); refresh().then(() => $("tb-grid").querySelectorAll(".tb-card").forEach((c) => obs && (obs.unobserve(c), obs.observe(c)))); };
    $("tb-q").oninput = (e) => { filter = e.target.value.trim().toLowerCase(); syncGrid(); };
    $("tb-ext").onclick = async () => {
      const b = $("tb-ext"); b.disabled = true;
      try {
        const r = await api("/api/tabs/ext-install", { method: "POST" });
        if (!r.ok) toast(r.message, true);
        else {
          $("tb-err-t").textContent = "EXTENSION PRÊTE : 3 CLICS DANS CHROME";
          $("tb-err-m").textContent = "Dans l'onglet chrome://extensions qui vient de s'ouvrir : 1) activez « Mode développeur » (en haut à droite) ; 2) cliquez « Charger l'extension non empaquetée » ; 3) choisissez le dossier ouvert dans l'Explorateur (" + r.folder + "). Vos onglets apparaissent ici dans quelques secondes.";
          let n = 0; const t = setInterval(async () => { if (++n > 40 || !isOpen()) return clearInterval(t); await refresh(); if ($("tb-err").hidden) clearInterval(t); }, 3000);
        }
      } catch (e) { toast(e.message, true); }
      b.disabled = false;
    };
    $("tb-launch").onclick = async () => {
      const b = $("tb-launch"); b.disabled = true; b.textContent = "OUVERTURE…";
      try { const r = await api("/api/tabs/open-chrome", { method: "POST" }); if (!r.ok) toast(r.message, true); else { await wait(1500); await refresh(true); } }
      catch (e) { toast(e.message, true); }
      b.disabled = false; b.textContent = "OUVRIR LE CHROME E.N.O.S.";
    };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen() && document.activeElement !== $("tb-q")) close(); });
  }
  init();
})();
