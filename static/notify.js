"use strict";
// Fin de tâche : joue la phrase réflexe de E.N.O.S. (la notification Windows native est émise côté Python).
(() => {
  let since = 0, started = false;
  async function poll() {
    try {
      const r = await fetch("/api/notify/poll?since=" + since);       // sec.js ajoute l'authentification à fetch (comme pour les autres modules)
      if (!r.ok) return;
      const j = await r.json();
      for (const e of j.events || []) {
        if (e.id > since) since = e.id;
        if (started) window.dispatchEvent(new CustomEvent("enos:notify", { detail: e }));      // home.js : toast de l'IA proactive
        if (started && e.voice && window.say) window.say(e.voice.text, { audio: e.voice.audio });
      }
      started = true;                                              // le 1er passage ne rejoue pas d'anciens événements
    } catch (e) { /* hors ligne : réessai au prochain tour */ }
  }
  setInterval(poll, 2500);
})();
