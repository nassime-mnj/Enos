"use strict";
// ÉCRAN DE PARTIE CHESS (version PC, maquette « Obsidian Crimson ») : présentation seulement. Toute la logique reste dans defi.js (mêmes identifiants).
// Ce script remplit les bandeaux adversaire / joueur à partir de ce que defi.js affiche déjà (noms des camps, puissance, mode, Elo du bot, statut),
// traduit l'évaluation du moteur en phrase, pose les icônes et relie la barre de raccourcis aux vrais boutons. Aucune donnée inventée.
(() => {
  const $ = (id) => document.getElementById(id);
  const cs = $("cs"); if (!cs) return;
  const icon = (n) => (window.ENOS && window.ENOS.hubIcon ? window.ENOS.hubIcon(n) : "");
  const paintIcons = () => cs.querySelectorAll("[data-ic]").forEach((b) => { if (!b.querySelector(".hi")) b.insertAdjacentHTML("afterbegin", icon(b.dataset.ic)); });

  // raccourcis de la barre latérale : ils déclenchent les vrais boutons de defi.js
  cs.querySelector(".cs-rail").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.proxy) { const t = $(b.dataset.proxy); if (t) t.click(); }
    if (b.dataset.goto) { const d = $(b.dataset.goto); if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); d.classList.remove("ping"); void d.offsetWidth; d.classList.add("ping"); } }
  });
  // accueil Échecs : on referme la partie (elle reste en mémoire côté serveur) et on ouvre le hub
  $("cs-hub").addEventListener("click", () => {
    $("cs-close").click();
    setTimeout(() => { const df = $("df"); if (df) df.hidden = true; if (window.enosOpenChess) window.enosOpenChess(); }, 0);
  });

  // évaluation -> phrase
  function evalText(t) {
    if (/MAT/i.test(t)) return "Mat en vue";
    const v = parseFloat(String(t).replace(",", ".")); if (!isFinite(v)) return "";
    const a = Math.abs(v), side = v > 0 ? "les Blancs" : "les Noirs";
    return a < 0.3 ? "Égalité" : a < 1 ? "Léger avantage pour " + side : a < 2.5 ? "Avantage net pour " + side : "Position gagnante pour " + side;
  }
  // bandeaux : noms et couleurs des camps (étiquettes #cs-sides de defi.js), Elo réel du réglage en cours
  const txt = (el) => (el ? el.textContent.trim() : "");
  function oppDefault(mode) {
    const opp = $("cs-opp") ? $("cs-opp").value : "enos";
    if (mode === "coach" || mode === "speedrun") return "Bot " + ($("cs-elo") ? $("cs-elo").value : "") + " Elo";
    if (mode === "boss") return "Stockfish";
    if (mode === "titans") return "ETO";
    return opp === "eto" || opp === "eto_brillant" ? "ETO" : (window.enosPersona ? window.enosPersona.name() : "E.N.O.S.");
  }
  function rating(name, mode) {
    if (/stockfish/i.test(name)) return "MAX";
    if (/^eto$/i.test(name.trim())) return "3650";
    const num = (name.match(/(\d{3,4})/) || [])[1];
    if (/^bot\b/i.test(name)) return num || "—";
    if ((mode === "coach" || mode === "speedrun") && !/e\.?n\.?o\.?s|eto/i.test(name)) return ($("cs-elo") && $("cs-elo").value) || "—";
    const pt = txt($("cs-powtxt")), p = (pt.match(/(\d{3,4})(\+?)\s*Elo/) || []);
    return p[1] ? p[1] + p[2] : "—";
  }
  let last = "";
  function tick() {
    if (cs.hidden) return;
    const mode = (cs.dataset.mode || ($("cs-mode") && $("cs-mode").value) || "enos");
    const sd = [...cs.querySelectorAll("#cs-sides .cs-sd")];
    const on = sd[0] ? txt(sd[0].querySelector("b")) : oppDefault(mode), mn = sd[1] ? txt(sd[1].querySelector("b")) : "Vous";
    const oc = sd[0] ? txt(sd[0].querySelector("small")) : "", mc = sd[1] ? txt(sd[1].querySelector("small")) : "";
    const status = txt($("cs-status")), ev = txt($("cs-evalv"));
    const key = [mode, on, mn, oc, mc, status, ev, txt($("cs-powtxt")), $("cs-elo") && $("cs-elo").value].join("|");
    if (key === last) return; last = key;
    $("cs-oname").textContent = on || oppDefault(mode); $("cs-mname").textContent = (mn || "Vous").toUpperCase() === "VOUS" ? "VOUS" : mn;
    $("cs-orate").textContent = rating(on || oppDefault(mode), mode);
    const chip = (el, c) => { el.textContent = c; el.dataset.c = /BLANC/.test(c) ? "w" : /NOIR/.test(c) ? "b" : ""; el.hidden = !c; };
    chip($("cs-ocol"), oc); chip($("cs-mcol"), mc);
    const th = /réfléchit/i.test(status);
    $("cs-othink").classList.toggle("on", th); $("cs-othink").textContent = th ? "réfléchit" : "";
    cs.querySelector(".cs-ban.me").classList.toggle("turn", /à vous/i.test(status));
    cs.querySelector(".cs-ban.opp").classList.toggle("turn", th);
    $("cs-evtxt").textContent = evalText(ev);
    const v = parseFloat(ev.replace(",", ".")); $("cs-evalv").dataset.s = /MAT/.test(ev) ? "m" : !isFinite(v) || Math.abs(v) < 0.3 ? "" : v > 0 ? "w" : "b";
  }
  new MutationObserver(() => { if (!cs.hidden) { paintIcons(); last = ""; tick(); } }).observe(cs, { attributes: true, attributeFilter: ["hidden"] });
  setInterval(tick, 400);
  paintIcons();
  // la colonne de droite défile seule ; la liste de coups suit le dernier coup
  // ---------------------------------------------------------------- DÉFI (maquette « Repousse tes limites »)
  const df = $("df");
  if (df) {
    const paintDf = () => df.querySelectorAll("[data-ic]").forEach((b) => { if (!b.querySelector(".hi")) b.insertAdjacentHTML("afterbegin", icon(b.dataset.ic)); });
    paintDf();
    df.addEventListener("click", (e) => {
      const b = e.target.closest("[data-proxy]"); if (!b) return;
      if (!b.dataset.proxy) { df.querySelector(".df-body").scrollTo({ top: 0, behavior: "smooth" }); return; }
      const t = $(b.dataset.proxy); if (t) t.click();
    });
    const hub = $("df-hub"); if (hub) hub.onclick = () => { df.hidden = true; if (window.enosOpenChess) window.enosOpenChess(); };
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    async function last() {                                                      // vraies parties (historique de nasko_chess) ; rien d'inventé si l'historique est vide
      const row = $("df-lrow"); if (!row) return;
      try {
        const r = await fetch("/api/chess/history").then((x) => (x.ok ? x.json() : Promise.reject(new Error(x.status))));
        const g = (r.games || []).slice(0, 5);
        $("df-lcount").textContent = r.games && r.games.length ? r.games.length + " partie" + (r.games.length > 1 ? "s" : "") + " enregistrée" + (r.games.length > 1 ? "s" : "") : "";
        row.innerHTML = g.length ? g.map((x) => `<div class="df-lg o-${esc(x.outcome)}"><b>${esc(String(x.outcome || "").toUpperCase())}</b><span>${x.me === "w" ? "Blancs" : "Noirs"} · E.N.O.S. ${esc(x.elo)} Elo</span><small>${esc(new Date(x.date).toLocaleDateString("fr-FR"))} · ${esc(x.n_moves)} demi-coups</small></div>`).join("")
          : `<div class="df-lnone">Aucune partie enregistrée pour le moment : lance un CHESS, elle apparaîtra ici.</div>`;
      } catch (e) { row.innerHTML = `<div class="df-lnone">Historique indisponible.</div>`; }
    }
    new MutationObserver(() => { if (!df.hidden) { paintDf(); last(); } }).observe(df, { attributes: true, attributeFilter: ["hidden"] });
  }
  window.ENOS_CHESS_UI = { tick, evalText };
})();
