"use strict";
// PROFIL ÉCHECS (façon Chess.com, à notre échelle) : STATISTIQUES par cadence et par période, HISTORIQUE des parties (revoir, éditer, copier le PGN), PRIX (succès débloqués par tes parties).
// Tout est calculé sur le téléphone à partir des parties enregistrées (Défis, Variantes) : aucun classement mondial, aucune compétition.
(() => {
  const E = window.ENOS, esc = E.esc, CC = (n) => `img/menu/cc_${n}.png`;
  const TCS = [["daily", "En différé", "daily"], ["rapid", "Rapide", "rapid"], ["blitz", "Blitz", "blitz"], ["bullet", "Bullet", "bullet"], ["none", "Sans pendule", "board"]];
  const PERIODS = [["7J", 7], ["30J", 30], ["90J", 90], ["1A", 365], ["TOUT", 0]];
  const hist = () => (E.settings.get("defi.hist", []) || []).filter((x) => x && x.mv);
  const outcome = (x) => {                                                                // v / n / d du point de vue du joueur (parties où il joue)
    if (!x.me) return null; const r = String(x.result || ""); if (/nulle/i.test(r)) return "d";
    const w = /Blancs gagnent/.test(r) ? "w" : /Noirs gagnent/.test(r) ? "b" : ""; return w ? (w === x.me ? "v" : "n") : null;
  };
  const mine = () => hist().filter((x) => x.me);
  const fmtDate = (t) => new Date(t).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });

  // ------------------------------------------------------------------ PRIX (succès)
  const PRIZES = (all, mn) => {
    const wins = mn.filter((x) => outcome(x) === "v"), tcSeen = new Set(all.map((x) => x.tc || "none")), brill = all.reduce((a, x) => a + (x.brill || 0), 0);
    let streak = 0, best = 0; mn.slice().sort((a, b) => a.t - b.t).forEach((x) => { if (outcome(x) === "v") { streak++; best = Math.max(best, streak); } else streak = 0; });
    const vs = (re) => wins.some((x) => re.test((x.me === "w" ? x.pb : x.pw) || ""));
    return [
      { id: "first", n: "Première partie", cc: "board", v: all.length, max: 1 }, { id: "g10", n: "10 parties", cc: "pawn_w", v: all.length, max: 10 }, { id: "g50", n: "50 parties", cc: "knight_w", v: all.length, max: 50 }, { id: "g200", n: "200 parties", cc: "rook_w", v: all.length, max: 200 },
      { id: "w1", n: "Première victoire", cc: "medal", v: wins.length, max: 1 }, { id: "w10", n: "10 victoires", cc: "medal", v: wins.length, max: 10 }, { id: "w50", n: "50 victoires", cc: "medal", v: wins.length, max: 50 }, { id: "st3", n: "Série de 3", cc: "rush", v: best, max: 3 },
      { id: "b1", n: "Premier brillant", cc: "mate", v: brill, max: 1 }, { id: "b10", n: "10 brillants", cc: "mate", v: brill, max: 10 }, { id: "b50", n: "50 brillants", cc: "mate", v: brill, max: 50 },
      { id: "acc", n: "Précision 90 %", cc: "vision", v: Math.max(0, ...mn.map((x) => x.acc || 0)), max: 90 },
      { id: "bullet", n: "Bullet", cc: "bullet", v: tcSeen.has("bullet") ? 1 : 0, max: 1 }, { id: "blitz", n: "Blitz", cc: "blitz", v: tcSeen.has("blitz") ? 1 : 0, max: 1 }, { id: "rapid", n: "Rapide", cc: "rapid", v: tcSeen.has("rapid") ? 1 : 0, max: 1 }, { id: "daily", n: "Différé", cc: "daily", v: tcSeen.has("daily") ? 1 : 0, max: 1 },
      { id: "team", n: "Partie d'équipe", cc: "users", v: all.some((x) => x.pk && x.pk[0] === "team") ? 1 : 0, max: 1 }, { id: "var", n: "Variante", cc: "variants", v: (E.settings.get("variants.hist", []) || []).length ? 1 : 0, max: 1 },
      { id: "long", n: "Partie de 80 coups", cc: "timer", v: Math.max(0, ...all.map((x) => Math.floor((x.plies || 0) / 2))), max: 80 }, { id: "sf", n: "Battre Stockfish", cc: "fish", v: vs(/Stockfish/i) ? 1 : 0, max: 1 }, { id: "eto", n: "Battre ETO", cc: "fork", v: vs(/ETO/i) ? 1 : 0, max: 1 }, { id: "enos", n: "Battre E.N.O.S.", cc: "pin", v: vs(/E\.N\.O\.S/i) ? 1 : 0, max: 1 },
    ];
  };

  E.suite.register({
    id: "chessprofile", group: "chess", title: "Profil échecs", sub: "Statistiques · historique · prix",
    icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    build(el, A) {
      const $ = (s) => el.querySelector(s); let tab = "stats", period = 90, openTc = "";
      el.innerHTML = `<div class="pf-head"><img src="${CC("user")}" alt=""><div><b id="pf-name"></b><small id="pf-sub"></small></div></div>
        <div class="seg pf-seg" id="pf-seg"><button data-t="stats" class="on">STATISTIQUES</button><button data-t="games">HISTORIQUE</button><button data-t="prizes">PRIX</button><i class="seg-ind"></i></div><div id="pf-body"></div>`;
      $("#pf-name").textContent = (E.userName && E.userName()) || (E.ai && E.ai.name && E.ai.name()) || "Joueur";

      function stats() {
        const all = mine(), lim = period ? Date.now() - period * 864e5 : 0, rows = all.filter((x) => x.t >= lim), brill = rows.reduce((a, x) => a + (x.brill || 0), 0), accs = rows.map((x) => x.acc).filter((v) => v != null);
        const by = {}; rows.forEach((x) => { const k = x.tc || "none", o = (by[k] ||= { v: 0, n: 0, d: 0, a: [] }), r = outcome(x); if (r) o[r]++; if (x.acc != null) o.a.push(x.acc); });
        const line = (k, name, ic) => { const o = by[k]; if (!o) return ""; const t = o.v + o.n + o.d, acc = o.a.length ? Math.round(o.a.reduce((s, x) => s + x, 0) / o.a.length * 10) / 10 : null;
          return `<div class="pf-row" data-k="${k}"><img src="${CC(ic)}" alt=""><b>${name}</b><span class="pf-num">${acc != null ? String(acc).replace(".", ",") + " %" : "—"}</span><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></div>
            <div class="pf-det${openTc === k ? " on" : ""}"><div class="pf-bar"><i class="w" style="flex:${o.v}"></i><i class="d" style="flex:${o.d}"></i><i class="l" style="flex:${o.n}"></i></div><div class="pf-wdl"><span><b>${o.v}</b> victoires</span><span><b>${o.d}</b> nulles</span><span><b>${o.n}</b> défaites</span><span><b>${t}</b> parties</span></div></div>`; };
        $("#pf-body").innerHTML = `<div class="pf-per">${PERIODS.map(([n, d]) => `<button data-d="${d}" class="${d === period ? "on" : ""}">${n}</button>`).join("")}</div>
          <div class="pf-big"><img src="${CC("rush")}" alt=""><b>${rows.length}</b><span>parties</span></div>
          <div class="pf-card">${TCS.map(([k, n, ic]) => line(k, n, ic)).join("") || '<p class="pf-empty">Joue un défi : tes statistiques apparaissent ici.</p>'}
            <div class="pf-row static"><img src="${CC("mate")}" alt=""><b>Coups brillants</b><span class="pf-num">${brill}</span></div>
            <div class="pf-row static"><img src="${CC("vision")}" alt=""><b>Précision moyenne</b><span class="pf-num">${accs.length ? String(Math.round(accs.reduce((s, x) => s + x, 0) / accs.length * 10) / 10).replace(".", ",") + " %" : "—"}</span></div></div>`;
        $("#pf-sub").textContent = all.length + " partie" + (all.length > 1 ? "s" : "") + " jouée" + (all.length > 1 ? "s" : "");
      }
      function games() {
        const l = hist().slice().reverse().slice(0, 80);
        $("#pf-body").innerHTML = l.length ? `<div class="pf-card">${l.map((x, i) => { const o = outcome(x), tc = TCS.find((q) => q[0] === (x.tc || "none")) || TCS[4];
          return `<div class="pf-game"><span class="pf-res ${o || "x"}">${o === "v" ? "V" : o === "n" ? "D" : o === "d" ? "N" : "·"}</span><div class="pf-gn"><b>${esc(x.pw)} – ${esc(x.pb)}</b><small>${fmtDate(x.t)} · ${Math.ceil((x.plies || 0) / 2)} coups${x.acc != null ? " · " + String(x.acc).replace(".", ",") + " %" : ""}</small></div><img src="${CC(tc[2])}" alt=""><button class="pf-b" data-r="${i}" aria-label="Revoir"><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg></button><button class="pf-b" data-e="${i}" aria-label="Chess Edit"><svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16"/></svg></button></div>`; }).join("")}</div>` : '<p class="pf-empty">Aucune partie enregistrée.</p>';
        $("#pf-body")._l = l;
      }
      function prizes() {
        const all = hist(), P = PRIZES(all, mine()), got = P.filter((p) => p.v >= p.max).length;
        $("#pf-body").innerHTML = `<div class="pf-big"><img src="${CC("medal")}" alt=""><b>${got}</b><span>/ ${P.length} prix</span></div><div class="pf-prizes">${P.map((p) => { const ok = p.v >= p.max; return `<div class="pf-prize${ok ? " ok" : ""}"><img src="${CC(p.cc)}" alt=""><b>${esc(p.n)}</b>${ok ? "" : `<i>${Math.min(p.v, p.max)}/${p.max}</i>`}</div>`; }).join("")}</div>`;
      }
      const render = () => { if (tab === "stats") stats(); else if (tab === "games") games(); else prizes(); };
      const setTab = (t) => { tab = t; $("#pf-seg").dataset.i = ["stats", "games", "prizes"].indexOf(t); el.querySelectorAll("#pf-seg button").forEach((b) => b.classList.toggle("on", b.dataset.t === t)); render(); };
      $("#pf-seg").onclick = (e) => { const b = e.target.closest("button"); if (b) setTab(b.dataset.t); };
      $("#pf-body").onclick = (e) => {
        const d = e.target.closest("[data-d]"); if (d) { period = +d.dataset.d; return stats(); }
        const r = e.target.closest(".pf-row[data-k]"); if (r) { openTc = openTc === r.dataset.k ? "" : r.dataset.k; return stats(); }
        const rv = e.target.closest("[data-r]"), ed = e.target.closest("[data-e]"), l = $("#pf-body")._l || [];
        if (rv) { const rec = l[+rv.dataset.r]; E.modules.open("defis"); setTimeout(() => { const a = document.querySelector("#tool-defis .suite-body"); if (a && a._api) a._api.replay(rec); }, 200); }
        if (ed && E.chessEdit) E.chessEdit.open(l[+ed.dataset.e]);
      };
      el._api = { tab: (t) => setTab(t === "games" || t === "prizes" ? t : "stats"), render };
      render();
      E.on("settings", () => { if (!el.closest("[hidden]")) render(); });
    },
  });
})();
