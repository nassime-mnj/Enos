"use strict";
// Ouvre « Échecs · Apprendre & Conseiller » (static/learn/) en plein écran par-dessus l'interface ; la page prévient (postMessage) quand on la ferme.
// Trois boutons : APPRENDRE LES ÉCHECS (puzzles, ouvertures…), CONSEILLER BRILLANTS (capture d'écran → coups brillants) et ARÈNE DES BOTS (#arena).
(() => {
  let box = null;
  const close = () => { if (box) { box.remove(); box = null; } };
  const open = (hash) => {
    if (box) return;
    box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#050506";
    const f = document.createElement("iframe");
    f.src = "/static/learn/" + (hash || ""); f.title = "Échecs"; f.style.cssText = "width:100%;height:100%;border:0";
    box.append(f); document.body.append(box);
  };
  window.enosOpenLearn = open;
  window.enosOpenChess = () => open("");                                       // le hub Échecs (Applications, Défi)
  const learn = document.getElementById("b-learn"), adv = document.getElementById("b-adv");
  if (learn) learn.addEventListener("click", () => open(""));
  if (adv) adv.addEventListener("click", () => open("#advisor"));
  const arena = document.getElementById("b-arena");
  if (arena) arena.addEventListener("click", () => open("#arena"));
  const variants = document.getElementById("b-variants");
  if (variants) variants.addEventListener("click", () => open("#variants"));
  [["b-chessedit", "#chessedit"], ["b-clips", "#clips"], ["b-backup", "#backup"]].forEach(([id, h]) => { const b = document.getElementById(id); if (b) b.addEventListener("click", () => open(h)); });
  const royale = document.getElementById("b-royale");
  if (royale) royale.addEventListener("click", () => open("#royale"));
  // DÉFI › BOTS et DÉFI › CHESS › mode « BOTS · ARÈNE » : même Arène que le bouton du panneau
  const dfBots = document.getElementById("df-bots");
  if (dfBots) dfBots.addEventListener("click", () => open("#arena"));
  const csMode = document.getElementById("cs-mode");
  if (csMode) csMode.addEventListener("change", () => {
    if (csMode.value !== "bots") return;
    let prev = "enos"; try { prev = localStorage.getItem("enos_chess_mode") || "enos"; } catch (e) { /* stockage indisponible */ }
    csMode.value = ["enos", "coach", "speedrun", "titans", "boss"].includes(prev) ? prev : "enos";
    // (écouteur en phase de capture : la valeur est déjà rétablie quand defi.js repeint l'écran avec le mode précédent)
    open("#arena");
  }, true);
  // DÉFI › JEUX NÉON : fenêtre Godot (nasko_jeux.py)
  const gmsg = document.getElementById("df-gmsg");
  document.querySelectorAll("[id^=df-g-]").forEach((b) => b.addEventListener("click", async () => {
    if (gmsg) gmsg.textContent = "Lancement…";
    try {
      const r = await fetch("/api/jeux/lancer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game: b.id.slice(5) }) });
      const j = await r.json().catch(() => ({}));
      if (gmsg) gmsg.textContent = r.ok ? "Jeu lancé dans une nouvelle fenêtre." : (j.detail || "Erreur " + r.status);
    } catch (e) { if (gmsg) gmsg.textContent = "Impossible de contacter ENOS."; }
  }));
  // HUB ÉCHECS (static/learn/hub.js) : les modes qui vivent dans cette fenêtre (partie contre E.N.O.S., mise en condition, ouvertures avec ETO,
  // Super ENOS, historique) sont demandés par postMessage ; en les refermant, on revient au hub.
  const $ = (id) => document.getElementById(id);
  let fromHub = false;
  function hubAct(act, mode) {
    const need = { play: "df-chess", hist: "df-chess", train: "df-chess", cond: "df-cond", study: "b-st" }[act];
    const btn = need && $(need);
    if (!btn) { const f = box && box.querySelector("iframe"); if (f) f.contentWindow.postMessage({ enos: "learn-toast", msg: "Ce mode n'est disponible que sur le PC où tourne E.N.O.S." }, "*"); return; }
    close(); fromHub = true;
    if (act === "play" && mode && $("cs-mode") && [...$("cs-mode").options].some((o) => o.value === mode)) {
      $("cs-mode").value = mode; $("cs-mode").dispatchEvent(new Event("change", { bubbles: true }));
    }
    btn.click();
    if (act === "hist" && $("cs-hbtn")) setTimeout(() => $("cs-hbtn").click(), 60);
    if (act === "train" && $("cs-trbtn")) setTimeout(() => $("cs-trbtn").click(), 60);
  }
  ["cs-close", "cd-close", "st-close"].forEach((id) => { const b = $(id); if (b) b.addEventListener("click", () => {
    if (!fromHub) return;
    fromHub = false;
    setTimeout(() => { const df = $("df"); if (df) df.hidden = true; open(""); }, 0);       // après le gestionnaire d'origine (qui rouvre la liste DÉFI)
  }); });
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.enos === "learn-close") close();
    if (e.data.enos === "learn-act") hubAct(String(e.data.act || ""), String(e.data.mode || ""));
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
})();
