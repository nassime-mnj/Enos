"use strict";
// PURGE.EXE (téléphone) : tuile « Jeux ». Le moteur est dans purge.js (le même fichier que sur le PC) ; la partie s'ouvre en plein écran, hors ligne.
(() => {
  const E = window.ENOS;
  E.suite.register({
    id: "purge", group: "games", title: "PURGE.EXE", sub: "Survivor · des centaines de virus",
    icon: '<circle cx="12" cy="12" r="3.2"/><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/>',
    build(el) {
      let game = null, box = null;
      const best = () => { try { return +localStorage.getItem("enos.purge.best") || 0; } catch (e) { return 0; } };
      el.innerHTML = `<div class="card"><h3>PURGE.EXE</h3>
        <p class="muted" style="line-height:1.5">Tu es l'œil d'E.N.O.S. Glisse ton doigt pour te déplacer : <b>lasers</b> et <b>ondes de choc</b> partent tout seuls. Des centaines de virus convergent vers toi. À chaque niveau, choisis une <b>mise à jour système</b> parmi trois.</p>
        <div class="row" style="margin-top:10px"><button class="btn pri" id="pg-play">▶ JOUER</button></div>
        <p class="muted" style="font-size:12.5px;margin-top:8px" id="pg-best"></p></div>`;
      const paintBest = () => { el.querySelector("#pg-best").textContent = best() ? "Record : " + best() : "Aucune partie pour l'instant."; };
      const close = () => { if (game) { game.destroy(); game = null; } if (box) { box.remove(); box = null; } document.body.style.overflow = ""; paintBest(); };
      el.querySelector("#pg-play").onclick = () => {
        box = document.createElement("div"); box.id = "purge-full";
        box.style.cssText = "position:fixed;inset:0;z-index:9000;background:#06060a";
        document.body.appendChild(box); document.body.style.overflow = "hidden";
        game = window.ENOSPurge.mount(box, { onExit: close });
      };
      el._api = { close, get game() { return game; } };
      paintBest();
    },
  });
})();
