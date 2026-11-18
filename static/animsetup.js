"use strict";
// Setup Animation : le serveur ouvre l'explorateur (choix d'un dossier) puis range chaque fichier dans un sous-dossier portant son nom.
(() => {
  const btn = document.getElementById("b-animsetup");
  if (!btn) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const show = (html) => {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px";
    box.innerHTML = `<div style="background:#111418;color:#e8e8e8;border:1px solid #2a2f36;border-radius:10px;max-width:560px;width:100%;max-height:80vh;overflow:auto;padding:18px;font:14px system-ui,sans-serif">
      <h3 style="margin:0 0 10px">Setup Animation</h3>${html}
      <div style="text-align:right;margin-top:14px"><button class="btn" style="width:auto;padding:6px 16px">Fermer</button></div></div>`;
    box.addEventListener("click", (e) => { if (e.target === box || e.target.tagName === "BUTTON") box.remove(); });
    document.body.append(box);
  };
  let busy = false;
  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true; btn.style.opacity = ".6";
    try {
      const r = await fetch("/api/animsetup/run", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || r.statusText);
      if (j.cancelled) return;
      const list = j.moved.map(([f, d]) => `<li>${esc(f)} → <b>${esc(d)}/</b></li>`).join("");
      const errs = j.skipped.map(([f, why]) => `<li style="color:#ff8a8a">${esc(f)} : ${esc(why)}</li>`).join("");
      show(`<p style="margin:0 0 8px;opacity:.8">${esc(j.folder)}</p>
        <p><b>${j.moved.length}</b> fichier(s) rangé(s)${j.skipped.length ? `, <b>${j.skipped.length}</b> ignoré(s)` : ""}.</p>
        ${list ? `<ul style="margin:6px 0;padding-left:20px">${list}</ul>` : "<p>Aucun fichier à ranger à la racine de ce dossier.</p>"}
        ${errs ? `<ul style="margin:6px 0;padding-left:20px">${errs}</ul>` : ""}`);
    } catch (e) {
      show(`<p style="color:#ff8a8a">Échec : ${esc(e.message)}</p>`);
    } finally {
      busy = false; btn.style.opacity = "";
    }
  });
})();
