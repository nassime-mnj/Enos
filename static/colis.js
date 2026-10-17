"use strict";
// GÉRER LES COLIS : liste des .zip en attente, poids, contenu, renommage.
(() => {
  const $ = (id) => document.getElementById(id);
  const TOKEN = document.querySelector('meta[name="nasko-token"]').content;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { "X-Nasko-Token": TOKEN, "Content-Type": "application/json" } });
    if (!r.ok) {
      let d = r.statusText;
      try { d = (await r.json()).detail || d; } catch (e) {}
      throw new Error(typeof d === "string" ? d : "requête refusée");
    }
    return r.json();
  }
  const bytes = (n) => (n < 1024 ? n + " o" : n < 1048576 ? (n / 1024).toFixed(1) + " Ko" : (n / 1048576).toFixed(2) + " Mo");
  const when = (t) => new Date(t * 1000).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const base = (n) => n.replace(/\.zip$/i, "");
  let items = [], flash = "", toastT;

  function toast(msg, bad) {
    const t = $("cm-toast");
    t.textContent = msg; t.className = "cm-toast show" + (bad ? " bad" : "");
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = "cm-toast"), 4200);
  }

  async function load() {
    try { items = (await api("/api/colis")).items; }
    catch (e) { items = []; toast(e.message, true); }
    render();
  }

  function render(openName) {
    const box = $("cm-list");
    const openSet = new Set([...box.querySelectorAll(".cm-card.open")].map((c) => c.dataset.name));
    if (openName) openSet.add(openName);
    box.innerHTML = "";
    $("cm-empty").hidden = items.length > 0;
    const total = items.reduce((a, c) => a + c.size, 0);
    $("cm-sum").textContent = items.length ? `${items.length} colis · ${bytes(total)} au total` : "";
    items.forEach((c, i) => {
      const card = document.createElement("article");
      card.className = "cm-card" + (openSet.has(c.name) ? " open" : "") + (flash === c.name ? " flash" : "");
      card.dataset.name = c.name;
      card.style.animationDelay = Math.min(i, 12) * 55 + "ms";
      const files = c.files.map((f) => `<li><span>${esc(f.name)}</span><em>${bytes(f.size)}</em></li>`).join("");
      const more = c.count > c.files.length ? `<li class="more">… et ${c.count - c.files.length} autres fichiers</li>` : "";
      card.innerHTML = `
        <div class="cm-row">
          <div class="cm-ico" aria-hidden="true"><i></i><b>ZIP</b></div>
          <div class="cm-main">
            <div class="cm-name"><h4>${esc(base(c.name))}<span class="ext">.zip</span></h4>
              <form class="cm-edit" hidden autocomplete="off"><input type="text" maxlength="100" spellcheck="false" aria-label="Nouveau nom"><span class="ext">.zip</span>
                <button type="submit" class="cm-ok" title="Valider (Entrée)">✔</button><button type="button" class="cm-no" title="Annuler (Échap)">✕</button></form>
            </div>
            <div class="cm-chips"><span>⬢ ${bytes(c.size)}</span><span>▤ ${c.count} fichier${c.count > 1 ? "s" : ""}</span><span>◷ ${when(c.t)}</span></div>
            <div class="cm-err" role="alert" hidden></div>
          </div>
          <div class="cm-act">
            <button class="cm-b ren" title="Renommer le colis">✎<small>RENOMMER</small></button>
            <button class="cm-b tog" title="Voir le contenu" aria-expanded="${openSet.has(c.name)}">▾<small>CONTENU</small></button>
          </div>
        </div>
        <div class="cm-body"><div class="cm-inner"><ul class="cm-files">${files}${more}</ul>
          <div class="cm-foot">Poids décompressé : ${bytes(c.unpacked)}</div></div></div>`;
      wire(card, c);
      box.appendChild(card);
    });
    flash = "";
  }

  function wire(card, c) {
    const form = card.querySelector(".cm-edit"), inp = form.querySelector("input"), h = card.querySelector("h4"), err = card.querySelector(".cm-err");
    const edit = (on) => {
      form.hidden = !on; h.hidden = on; card.classList.toggle("editing", on);
      err.hidden = true;
      if (on) { inp.value = base(c.name); inp.focus(); inp.select(); }
    };
    card.querySelector(".ren").onclick = () => edit(form.hidden);
    card.querySelector(".cm-no").onclick = () => edit(false);
    inp.onkeydown = (e) => { if (e.key === "Escape") { e.stopPropagation(); edit(false); } };
    card.querySelector(".tog").onclick = (e) => {
      const open = card.classList.toggle("open");
      e.currentTarget.setAttribute("aria-expanded", open);
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const v = inp.value.trim();
      if (!v || v === base(c.name)) return edit(false);
      try {
        const r = await api("/api/colis/rename", { method: "POST", body: JSON.stringify({ name: c.name, new_name: v }) });
        flash = r.name;
        toast(`Colis renommé : ${base(c.name)} → ${base(r.name)}`);
        await load();
      } catch (er) {
        err.textContent = "⚠ " + er.message; err.hidden = false;
        form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake");   // petit tremblement d'erreur
        inp.focus();
      }
    };
  }

  const isOpen = () => !$("cm").hidden;
  function open() { $("cm").hidden = false; load(); }
  function close() { $("cm").hidden = true; }

  function init() {
    if (!$("cm")) return;
    document.querySelectorAll("[data-open-colis]").forEach((b) => (b.onclick = open));
    $("cm-close").onclick = close;
    $("cm-refresh").onclick = load;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) close(); });
  }
  init();
})();
