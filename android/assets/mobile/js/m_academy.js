"use strict";
// Code Academy sur téléphone : ouvre la page academy/ (copie de static/academy, voir sync_academy.py) en plein écran dans une iframe.
// Les cours, animations, quiz et la compilation animée marchent hors ligne ; JS s'exécute dans un Worker sur le téléphone ;
// Python, C, C++, Java et Shell passent par le serveur cloud (même bac à sable que CodeLab : Modules → Cloud pour se connecter).
(() => {
  const E = window.ENOS, A = (E.academy = E.academy || {});
  const SERVER = { python: "python", c: "c", cpp: "cpp", java: "java", shell: "shell" };
  let box = null;
  A.online = () => !!(E.cloud && E.cloud.loggedIn && E.cloud.loggedIn());
  A.run = async (lang, code, stdin) => {
    if (!SERVER[lang]) return { ok: false, phase: "setup", stdout: "", stderr: "Langage non pris en charge sur téléphone.", missing: true };
    if (!A.online()) return { ok: false, phase: "setup", stdout: "", stderr: "Ce langage s'exécute sur le serveur Dual Pulse.\nConnecte-toi : Modules → Cloud, puis relance.", missing: true };
    try {
      const r = await E.cloud.req("/codelab/run", { method: "POST", body: { language: SERVER[lang], code, stdin: stdin || "" } });
      const j = r.json || {};
      if (r.status === 200) return { ok: j.ok !== false && !j.timed_out, phase: j.phase || "run", stdout: j.stdout || "", stderr: j.stderr || "", ms: j.duration_ms, timeout: !!j.timed_out, code: j.exit_code };
      const why = { 401: "Session cloud expirée : reconnecte-toi.", 429: j.detail || "Trop d'exécutions : attends quelques secondes.", 503: j.detail || "Le bac à sable du serveur n'est pas disponible." }[r.status];
      return { ok: false, phase: "run", stdout: "", stderr: why || (typeof j.detail === "string" ? j.detail : "Erreur " + r.status) };
    } catch (e) { return { ok: false, phase: "run", stdout: "", stderr: "Serveur injoignable : " + e.message }; }
  };
  A.close = () => { if (box) { box.remove(); box = null; } };
  A.open = () => {
    if (box) return;
    box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#0b0d10;padding-top:env(safe-area-inset-top,0)";
    const f = document.createElement("iframe");
    f.src = "academy/index.html"; f.title = "Code Academy"; f.style.cssText = "width:100%;height:100%;border:0";
    box.append(f); document.body.append(box);
  };
  A.back = () => { if (!box) return false; A.close(); return true; };       // bouton retour d'Android (voir ui.js)
  window.addEventListener("message", (e) => { if (box && e.data && e.data.enos === "learn-close" && box.contains && e.source === box.querySelector("iframe").contentWindow) A.close(); });
  E.suite.register({
    id: "academy", group: "dev", title: "Code Academy", sub: "Cours animés Python · C · C++ · Java · JS · Shell",
    icon: '<path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/><path d="M14 4l-4 16"/>',
    build(el) {
      el.innerHTML = `<div class="card"><h3>Code Academy</h3><p class="muted">69 chapitres courts pour devenir expert : le code s'exécute pas à pas avec la mémoire animée, la compilation est expliquée en direct, puis des exercices corrigés automatiquement. JavaScript tourne sur le téléphone ; les autres langages utilisent le serveur cloud.</p><button class="btn" id="ac-go">Ouvrir Code Academy</button></div>`;
      el.querySelector("#ac-go").onclick = () => A.open();
    },
    onShow() { A.open(); },
  });
})();
