"use strict";
// MODULE « Journal de plantages » : lit le journal (Java + JavaScript), le copie, l'enregistre dans Téléchargements/ENOS, l'efface. Logique de collecte : js/crashlog.js (+ CrashLog.java).
(() => {
  const E = window.ENOS, esc = E.esc;
  E.suite.register({
    id: "crashlog", group: "sync", title: "Journal de plantages", sub: "Erreurs et fermetures inattendues",
    icon: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/>',
    onShow() { if (this._paint) this._paint(); },
    build(el, A) {
      const $ = (s) => el.querySelector(s), C = window.EnosCrash;
      el.innerHTML = `<div class="card"><h3>🛠 Journal de plantages</h3>
          <p class="muted">Plantages et erreurs de l'application. <b>Rien n'est envoyé</b> : le journal reste sur ce téléphone. Envoie-le moi par « Copier » ou « Enregistrer ».</p>
          <div id="cl-st" class="bk-st"></div>
          <div class="row"><button class="btn pri" id="cl-copy">📋 COPIER</button><button class="btn" id="cl-save">📁 ENREGISTRER</button><button class="btn" id="cl-clr">🗑 EFFACER</button></div></div>
        <div class="card"><h3>Contenu</h3><pre id="cl-log" style="white-space:pre-wrap;word-break:break-word;font-size:11.5px;line-height:1.35;max-height:52vh;overflow:auto;margin:0"></pre></div>`;
      function paint() {
        const txt = C ? C.read() : "", lines = txt.split("\n").filter((l) => /^\[\d{4}-/.test(l)), bad = C ? C.unseen().length : 0;
        $("#cl-st").innerHTML = `<div class="bk-row"><span>Entrées</span><b>${lines.length}</b></div><div class="bk-row"><span>Plantages / arrêts anormaux non lus</span><b class="${bad ? "" : "ok"}">${bad}</b></div>`;
        $("#cl-log").textContent = txt ? txt.split("\n").slice(-260).join("\n") : "Aucun problème enregistré.";
        if (C) C.markSeen();
      }
      this._paint = paint; paint();
      $("#cl-copy").onclick = () => A.copy(C.report());
      $("#cl-save").onclick = async () => { const name = "enos-journal-" + C.stamp().replace(/[: ]/g, "-") + ".txt"; await A.save(name, "text/plain", new TextEncoder().encode(C.report()), "downloads"); };
      $("#cl-clr").onclick = () => { C.clear(); paint(); A.toast("Journal effacé.", "ok"); };
    },
  });
})();
