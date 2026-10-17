"use strict";
// MISES À JOUR GÉRÉES PAR LE DUAL PULSE LAUNCHER : bannière discrète « Une mise à jour est prête. [Redémarrer pour appliquer] [Plus tard] ».
// Le Launcher télécharge en arrière-plan et pose un flag ; ici on l'interroge toutes les 30 s (page visible). « Redémarrer » ferme E.N.O.S. volontairement :
// le Launcher remplace les fichiers et relance l'application. « Plus tard » masque la bannière 4 h pour cette version. Texte du serveur inséré via textContent uniquement.
(() => {
  const SNOOZE_MS = 4 * 3600 * 1000, POLL_MS = 30000;
  let bar = null, busy = false;
  const get = async (p) => { const r = await window.fetch(p); if (!r.ok) throw new Error(String(r.status)); return r.json(); };
  const post = async (p) => { const r = await window.fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "Erreur " + r.status); return j; };
  const key = (v) => "enos.upd.later." + v;
  const snoozed = (v) => { try { return Date.now() < +(localStorage.getItem(key(v)) || 0); } catch (e) { return false; } };
  const snooze = (v) => { try { localStorage.setItem(key(v), String(Date.now() + SNOOZE_MS)); } catch (e) { /* stockage indisponible */ } };
  const el = (tag, attrs, text) => { const e = document.createElement(tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };

  function hide() { if (bar) { bar.remove(); bar = null; } }
  function show(r) {
    if (bar && bar.dataset.v === r.version) return;
    hide();
    bar = el("div", { class: "upd-bar", role: "status", "aria-live": "polite", "data-v": r.version });
    const msg = el("span", { class: "upd-msg" });
    msg.append(el("b", {}, "Une mise à jour est prête"), document.createTextNode(" (v" + r.version + ")."));
    if (r.notes) msg.title = r.notes;
    const go = el("button", { type: "button", class: "upd-go" }, "Redémarrer pour appliquer");
    const later = el("button", { type: "button", class: "upd-later" }, "Plus tard");
    go.onclick = async () => {
      if (busy) return; busy = true; go.disabled = later.disabled = true; go.textContent = "Fermeture…";
      try {
        await post("/api/update/launcher/apply");
        msg.textContent = "E.N.O.S. se ferme, le Launcher applique la mise à jour puis le relance…";
        go.remove(); later.remove();
      } catch (e) { busy = false; go.disabled = later.disabled = false; go.textContent = "Redémarrer pour appliquer"; msg.textContent = e.message; }
    };
    later.onclick = () => { snooze(r.version); hide(); };
    bar.append(msg, go, later);
    document.body.appendChild(bar);
  }
  function toast(text) {
    const t = el("div", { class: "upd-bar upd-done", role: "status" }, text);
    document.body.appendChild(t); setTimeout(() => t.remove(), 9000);
  }

  async function poll() {
    if (document.hidden || busy) return;
    let st;
    try { st = await get("/api/update/launcher"); } catch (e) { return; }
    if (st.applied) { toast("E.N.O.S. a été mis à jour vers la version " + st.applied.version + "."); post("/api/update/launcher/applied/seen").catch(() => {}); }
    if (st.ready && !snoozed(st.ready.version)) show(st.ready); else if (!st.ready) hide();
  }
  window.ensureUpdateBar = poll;
  setTimeout(poll, 3000);
  setInterval(poll, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
})();
