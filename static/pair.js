"use strict";
// BOUTON « APPAIRER LE TÉLÉPHONE » : un QR code, un code à 10 caractères, et le suivi en direct de l'appairage. Toute la préparation est faite par nasko_pairing.py.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let timer = 0, root = null;

  async function api(path, method) {
    const r = await fetch(path, { method: method || "GET" });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((j && j.detail) || "Erreur " + r.status);
    return j;
  }

  function build() {
    root = document.createElement("div");
    root.id = "pr";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Appairer le téléphone");
    root.innerHTML = `<div class="pr-card"><button class="pr-x" id="pr-x" aria-label="Fermer">✕</button>
      <div class="pr-k">TÉLÉPHONE</div><h2>Appairer le téléphone</h2>
      <div class="pr-body" id="pr-body"></div></div>`;
    document.body.appendChild(root);
    $("pr-x").onclick = close;
    root.addEventListener("mousedown", (e) => { if (e.target === root) close(); });
  }

  const body = (h) => { $("pr-body").innerHTML = h; };

  async function open() {
    if (root) return;
    build();
    body(`<div class="pr-wait"><i></i><span>Préparation… vérification de tes clés (quelques secondes)</span></div>`);
    try {
      const r = await api("/api/pair/start", "POST");
      body(`<div class="pr-grid">
          <div class="pr-qr">${r.qr ? `<img alt="QR code d'appairage" src="${r.qr}">` : `<div class="pr-url">${esc(r.url)}</div>`}</div>
          <div class="pr-steps">
            <ol><li>Sur le téléphone, <b>ouvre l'appareil photo</b> et scanne ce QR code.</li>
              <li>Appuie sur <b>« OUVRIR DANS E.N.O.S. »</b>.</li>
              <li>Tape ce code dans l'application :</li></ol>
            <div class="pr-code" id="pr-code">${esc(r.code)}</div>
            <div class="pr-state" id="pr-state"><i></i><span>En attente du scan…</span></div>
          </div></div>
        ${r.notes.length ? `<ul class="pr-notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
        <div class="pr-foot">Même Wi-Fi requis. Le paquet est chiffré ; le code reste sur cet écran. Lien actif ${Math.round(r.expires / 60)} min.
          <button class="pr-b" id="pr-redo">NOUVEAU CODE</button><button class="pr-b" id="pr-cancel">ANNULER</button></div>`);
      $("pr-cancel").onclick = close;
      $("pr-redo").onclick = () => { stop(); root.remove(); root = null; open(); };
      poll();
    } catch (e) {
      body(`<div class="pr-err">${esc(e.message)}</div><div class="pr-foot"><button class="pr-b" id="pr-cancel">FERMER</button></div>`);
      $("pr-cancel").onclick = close;
    }
  }

  function poll() {
    stop();
    timer = setInterval(async () => {
      if (!root) return stop();
      let s;
      try { s = await api("/api/pair/status"); } catch (e) { return; }
      const st = $("pr-state");
      if (!st) return;
      if (s.state === "opened") { st.className = "pr-state go"; st.querySelector("span").textContent = "Page ouverte : tape le code dans l'application…"; }
      else if (s.state === "paired") {
        st.className = "pr-state ok"; st.querySelector("span").textContent = `Appairé ✓  (${s.name || "téléphone"}) · l'onglet PC du téléphone est débloqué`;
        $("pr-code").classList.add("done"); stop();
        setTimeout(() => { if (root) close(true); }, 4500);
      } else if (s.state === "expired" || s.state === "cancelled") { st.className = "pr-state bad"; st.querySelector("span").textContent = "Lien expiré : clique sur NOUVEAU CODE."; stop(); }
    }, 1500);
  }
  const stop = () => { clearInterval(timer); timer = 0; };

  function close(done) {
    stop();
    if (!done) fetch("/api/pair/cancel", { method: "POST" }).catch(() => {});           // fermer = annuler : le lien et l'approbation d'avance disparaissent
    if (root) { root.classList.add("out"); const r = root; root = null; setTimeout(() => r.remove(), 220); }
  }

  window.enosPair = { open, close };
})();
