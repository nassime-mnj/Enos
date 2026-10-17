"use strict";
// ŒIL DE BUREAU : bouton du menu qui lance / arrête le widget Godot flottant.
(() => {
  const btn = document.getElementById("b-pet"), sub = document.getElementById("pet-sub");
  if (!btn) return;
  const api = async (p, o = {}) => {
    const r = await fetch(p, { ...o, headers: { "Content-Type": "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || r.statusText);
    return j;
  };
  const idle = sub.textContent;
  let on = false;
  const paint = (st) => {
    on = !!st.running;
    btn.firstChild.textContent = on ? "ŒIL DE BUREAU · ACTIF" : "ŒIL DE BUREAU";
    sub.textContent = on ? "Clic sur l'œil : micro + vision · clic droit : fermer · cliquer ici pour l'arrêter" : idle;
  };
  async function refresh() { try { paint(await api("/api/pet/status")); } catch (e) {} }
  btn.onclick = async () => {
    try {
      paint(await api(on ? "/api/pet/stop" : "/api/pet/start", { method: "POST", body: "{}" }));
      document.body.classList.remove("menu-open");
    } catch (e) { sub.textContent = e.message; }
  };
  refresh(); setInterval(refresh, 5000);

  // ASPIRATEUR : l'Œil est aspiré vers l'écran voisin (à droite, sinon à gauche : le même bouton le ramène dans l'autre sens).
  const vac = document.getElementById("b-vac"), vsub = document.getElementById("vac-sub");
  if (vac) {
    const vidle = vsub.textContent;
    vac.onclick = async () => {
      try {
        if (!on) paint(await api("/api/pet/start", { method: "POST", body: "{}" }));   // lance l'Œil s'il ne tourne pas
        for (let i = 0; i < 40; i++) {                                                    // attend sa connexion (≈ 8 s max)
          if ((await api("/api/pet/status")).connected) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        await api("/api/pet/vacuum", { method: "POST", body: JSON.stringify({ dir: "auto" }) });
        document.body.classList.remove("menu-open");
        vsub.textContent = vidle;
      } catch (e) { vsub.textContent = e.message; }
    };
  }

  // Fenêtre réduite : l'Œil (E.N.O.S.) ou le visage (ETO) apparaît sur le bureau ; il disparaît à la réouverture s'il a été lancé ainsi.
  // Désactivable : localStorage.enos_pet_on_min = "0".
  let auto = false;
  document.addEventListener("visibilitychange", async () => {
    let off = false; try { off = localStorage.getItem("enos_pet_on_min") === "0"; } catch (e) {}
    if (off) return;
    try {
      if (document.hidden) {
        const st = await api("/api/pet/status");
        if (st.available && !st.running) { paint(await api("/api/pet/start", { method: "POST", body: "{}" })); auto = true; }
      } else if (auto) {
        auto = false;
        const st = await api("/api/pet/status");
        if (st.running && !st.busy) paint(await api("/api/pet/stop", { method: "POST", body: "{}" }));
      }
    } catch (e) {}
  });
})();
