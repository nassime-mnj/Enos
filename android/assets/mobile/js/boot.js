"use strict";
// Démarrage : l'application fonctionne d'abord en mode AUTONOME (cache local + clés du coffre), puis le lien PC prend le relais quand il répond.
(() => {
  const E = window.ENOS;
  function boot() {
    E.agenda.loadCache();
    E.ui.init();
    E.views.init();
    E.theme.init();
    E.tools.init();
    E.suite.init();
    E.cloud.start();
    E.apps.init();
    E.chessUi.init();
    E.trainUi.init();
    E.modules.init();
    E.$$("[data-back]").forEach((b) => (b.onclick = () => E.tools.show("")));
    E.settingsInit();
    E.agenda.refresh(false);                                        // .ics lus directement par le téléphone (cache si hors ligne)
    E.importer.check();
    E.importer.checkBundled();                                             // un fichier envoyé par le PC (enos://import) attend-il ?
    E.link.start();                                                 // recherche du PC en tâche de fond (Wi-Fi puis Tailscale)
    setInterval(() => E.agenda.refresh(false), 5 * 60 * 1000);
    if (!E.ai.configured() && !E.store.get("welcomed", false)) {
      E.store.set("welcomed", true);
      setTimeout(() => E.ui.toast("Bienvenue : ouvre ⚙ Réglages pour ajouter tes clés (Groq, ElevenLabs).", "", 6500), 900);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
