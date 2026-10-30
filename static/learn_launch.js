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
  const learn = document.getElementById("b-learn"), adv = document.getElementById("b-adv");
  if (learn) learn.addEventListener("click", () => open(""));
  if (adv) adv.addEventListener("click", () => open("#advisor"));
  const arena = document.getElementById("b-arena");
  if (arena) arena.addEventListener("click", () => open("#arena"));
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
  window.addEventListener("message", (e) => { if (e.origin === location.origin && e.data && e.data.enos === "learn-close") close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
})();
