"use strict";
// LIEN AVEC LE PC — machine d'états qui fait basculer l'application entre le mode AUTONOME et le mode CONNECTÉ.
//
//   unpaired ──(adresse + jeton saisis)──▶ offline ◀──────────────┐
//                                            │  probe (Wi-Fi / Tailscale)
//                                            ▼                   │ 2 échecs de suite
//                                         probing ──ok──▶ online ┘
//                                            └─ 401/403 ──▶ denied (joignable mais appareil non approuvé « Eto Dev »)
//
// Déclencheurs d'un test IMMÉDIAT (sans attendre la temporisation) : retour au premier plan, changement de réseau Android (Wi-Fi rejoint,
// VPN Tailscale activé), bouton « RECONNECTER ». Hors ligne : test toutes les 5 s, puis 15 s après 2 min, 30 s après 10 min (économie de batterie).
(() => {
  const E = window.ENOS, N = E.native;
  const L = (E.link = { state: "unpaired", via: "", snap: null, offset: 0, since: 0, error: "" });
  let timer = 0, failStreak = 0, offlineSince = 0, busy = false, hb = 0;

  function set(state, extra) {
    const prev = L.state;
    Object.assign(L, extra || {});
    if (state === prev && !extra) return;
    L.state = state;
    E.state.mode = state === "online" ? "connected" : "standalone";
    E.emit("link", { state, prev, via: L.via });
  }

  // Appel d'API du PC (via Java : TLS épinglé + Bearer + identifiant d'appareil). Retourne {status, json()}.
  L.api = async (path, opts) => {
    opts = opts || {};
    return N.fetch({ provider: "pc", path, method: opts.method || "GET", body: opts.body ? JSON.stringify(opts.body) : "", headers: opts.body ? { "Content-Type": "application/json" } : {} });
  };

  const delay = () => { const t = Date.now() - (offlineSince || Date.now()); return t < 120000 ? 5000 : t < 600000 ? 15000 : 30000; };

  async function snapshot() {
    const t0 = Date.now() / 1000;
    const r = await L.api("/api/mobile/pc");
    if (r.status === 401 || r.status === 403) return { denied: true, status: r.status };
    if (r.status !== 200) return { error: "HTTP " + r.status };
    const j = r.json();
    if (!j) return { error: "réponse illisible" };
    L.offset = j.now - (t0 + Date.now() / 1000) / 2;             // écart d'horloge PC − téléphone (secondes) : sert à la synchro de l'agenda
    return { snap: j };
  }

  async function probe() {
    if (busy) return;
    busy = true;
    clearTimeout(timer);
    const cfg = N.pc.config();
    if (!cfg.paired) { busy = false; set("unpaired"); return; }
    if (L.state !== "online") set("probing");
    let ok = false;
    try {
      const p = await N.pc.probe(1500);
      ok = !!p.ok;
      if (!ok && p.reason === "cert") { failStreak = 0; set("denied", { error: "Le certificat du PC a changé (nouvelle IP ou réinstallation). Réglages → PC → VÉRIFIER pour valider la nouvelle empreinte." }); busy = false; timer = setTimeout(probe, 30000); return; }
      if (ok) {
        const wasOnline = L.state === "online";
        L.via = p.via || "";
        const s = await snapshot();
        if (s.denied) { failStreak = 0; set("denied", { error: "Appareil non approuvé : sur le PC, Réglages → Appareils de confiance → approuver ce téléphone." }); }
        else if (s.snap) {
          failStreak = 0; offlineSince = 0;
          L.snap = s.snap;
          const fresh = !wasOnline;
          set("online", { error: "" });
          E.emit("pc-snapshot", s.snap);
          if (fresh && L.since && s.snap.uptime_s < 240) E.emit("pc-booted", s.snap);          // le PC vient de démarrer pendant que l'app cherchait
          L.since = Date.now();
        } else ok = false;
      }
    } catch (e) { ok = false; }
    if (!ok) {
      failStreak += 1;
      if (L.state === "online" && failStreak < 2) { /* un raté isolé n'éteint pas le lien */ }
      else { if (!offlineSince) offlineSince = Date.now(); if (L.state !== "denied") set("offline", { snap: null, via: "" }); }
    }
    busy = false;
    timer = setTimeout(probe, L.state === "online" ? 15000 : L.state === "denied" ? 30000 : delay());
  }

  // Remise à zéro de la temporisation + test immédiat
  L.probeNow = () => { failStreak = 0; offlineSince = offlineSince || Date.now(); clearTimeout(timer); return probe(); };
  L.start = () => {
    L.probeNow();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) L.probeNow(); });
    E.on("net", (n) => { if (n.online) setTimeout(L.probeNow, 600); else { failStreak = 2; if (L.state === "online") set("offline", { snap: null, via: "" }); } });
    E.on("settings", (k) => { if (k === "pcAddrs" || k === "pcPaired") L.probeNow(); });
  };

  // Télémétrie rapide (2 s) uniquement tant que l'onglet PC est affiché
  L.watch = (on, cb) => {
    clearInterval(hb);
    if (!on) return;
    const tick = async () => { if (L.state !== "online" || document.hidden) return; try { const s = await snapshot(); if (s.snap) { L.snap = s.snap; E.emit("pc-snapshot", s.snap); } } catch (e) { /* le prochain probe tranchera */ } };
    tick();
    hb = setInterval(tick, 2000);
    if (cb) cb();
  };
})();
