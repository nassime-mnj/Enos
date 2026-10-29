"use strict";
// APPRENDRE LES ÉCHECS : puzzles (base libre Lichess, CC0) à difficulté adaptative, explorateur et entraînement d'ouvertures (base lichess-org/chess-openings),
// coups brillants (sacrifices gagnants), leçons et conseils personnalisés tirés de TES résultats (puzzles, analyses de parties, parties jouées).
// Tout fonctionne hors ligne. Fonctions pures dans window.ENOS.learnLib (testables) ; l'interface vient après.
(() => {
  const E = window.ENOS, esc = E.esc;                                // E.board arrive plus tard (board.js est chargé après ce fichier)
  const L = (E.learnLib = {});
  const GENERIC = new Set(["opening", "middlegame", "endgame", "short", "long", "crushing", "advantage", "equality"]);
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  // ------------------------------------------------------------------ pures
  /** Nouveau classement après un puzzle : Elo avec K=24 ; score 1 = résolu sans aide, 0 = raté / aidé. */
  L.rate = (mine, puzzle, score) => {
    const exp = 1 / (1 + Math.pow(10, (puzzle - mine) / 400));
    return Math.max(100, Math.min(3000, Math.round(mine + 24 * (score - exp))));
  };
  /** Un sacrifice : la pièce qui bouge vaut au moins 2 points de plus que ce qu'elle prend ET la case d'arrivée est attaquée. */
  L.isSacrifice = (fen, uci) => {
    const c = new Chess(fen), m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (!m || m.piece === "k") return false;
    const got = m.captured ? VAL[m.captured] : 0, gave = VAL[m.piece] + (m.promotion ? -VAL[m.piece] : 0);
    if (gave - got < 2) return false;
    return c.moves({ verbose: true }).some((x) => x.to === m.to && x.captured);
  };
  /** Arbre des ouvertures : nœud {c:{SAN:nœud}, n:nb de lignes passant ici, name:[eco,nom]|null} */
  L.trie = (lines) => {
    const root = { c: {}, n: 0, name: null };
    for (const [eco, name, mv] of lines) {
      let node = root;
      for (const san of mv.split(" ")) { node = node.c[san] || (node.c[san] = { c: {}, n: 0, name: null }); node.n++; }
      node.name = [eco, name];
    }
    return root;
  };
  /** Nom de l'ouverture la plus profonde sur le chemin (liste de SAN). */
  L.nameAt = (root, path) => {
    let node = root, best = null;
    for (const san of path) { node = node.c[san]; if (!node) break; if (node.name) best = node.name; }
    return best;
  };
  /** Conseils : entrée = stats {themeId:[tentatives, réussites]}, parties analysées, parties jouées, jours depuis le dernier entraînement. */
  L.advice = ({ stats, names, reviews, games, rating, idleDays }) => {
    const out = [];
    const weak = Object.entries(stats).filter(([t, [a]]) => a >= 4 && !GENERIC.has(t)).map(([t, [a, s]]) => ({ t, a, r: s / a })).filter((x) => x.r < 0.6).sort((x, y) => x.r - y.r).slice(0, 3);
    weak.forEach((w) => out.push({ h: "Point faible : " + (names[w.t] || w.t), t: `Tu réussis ${Math.round(w.r * 100)} % de tes puzzles sur ce thème (${w.a} essais). Reprends la leçon puis fais une série ciblée : c'est le plus rapide pour progresser.`, go: { tab: "puzzles", theme: w.t } }));
    const strong = Object.entries(stats).filter(([t, [a, s]]) => a >= 6 && s / a >= 0.85 && !GENERIC.has(t)).map(([t]) => t).slice(0, 3);
    if (strong.length) out.push({ h: "Tes points forts", t: strong.map((t) => names[t] || t).join(", ") + " : tu les maîtrises. Passe à des puzzles plus durs pour continuer à monter." });
    const rv = reviews.slice(-5);
    if (rv.length) {
      const blund = rv.reduce((s, r) => s + (r.counts.blunder || 0), 0) / rv.length, mist = rv.reduce((s, r) => s + (r.counts.mistake || 0), 0) / rv.length;
      const acc = rv.filter((r) => r.acc != null).map((r) => r.acc), avg = acc.length ? Math.round(acc.reduce((s, x) => s + x, 0) / acc.length) : null;
      if (blund >= 1.5) out.push({ h: "Trop de gaffes", t: `Environ ${blund.toFixed(1)} gaffes par partie sur tes 5 dernières analyses. Avant chaque coup : « qu'est-ce que mon adversaire menace ? » et « ma pièce est-elle protégée ? ». Entraîne-toi sur les pièces en prise.`, go: { tab: "puzzles", theme: "hangingPiece" } });
      else if (mist >= 2) out.push({ h: "Erreurs de calcul", t: `Environ ${mist.toFixed(1)} erreurs par partie. Prends l'habitude de comparer 2 ou 3 coups candidats avant de jouer, surtout quand la position est tendue.`, go: { tab: "puzzles", theme: "mateIn2" } });
      if (avg != null) out.push({ h: "Précision récente", t: `${avg} % de précision en moyenne sur tes dernières parties analysées.` + (avg < 70 ? " Joue plus lentement dans les positions critiques." : avg > 85 ? " Très propre : tu peux affronter un niveau plus fort." : "") });
      const brill = rv.reduce((s, r) => s + (r.counts.brilliant || 0), 0);
      if (brill) out.push({ h: "Coups brillants", t: `${brill} coup${brill > 1 ? "s" : ""} brillant${brill > 1 ? "s" : ""} dans tes dernières parties. Continue de chercher les sacrifices : entraîne-les dans l'onglet Puzzles › Brillants.`, go: { tab: "puzzles", theme: "brilliant" } });
    }
    const opn = {};
    reviews.forEach((r) => { if (r.opening) opn[r.opening] = (opn[r.opening] || 0) + 1; });
    const fav = Object.entries(opn).sort((a, b) => b[1] - a[1])[0];
    if (fav && fav[1] >= 2) out.push({ h: "Ton ouverture favorite", t: `Tu joues souvent « ${fav[0]} ». Apprends ses 8 à 10 premiers coups par cœur dans l'onglet Ouvertures.`, go: { tab: "openings" } });
    const g = games.slice(-10);
    if (g.length >= 4) {
      const wins = g.filter((x) => x.result === "win").length, loss = g.filter((x) => x.result === "loss").length;
      if (wins / g.length >= 0.7) out.push({ h: "Tu domines tes adversaires", t: `${wins} victoires sur ${g.length}. Monte le niveau de l'adversaire pour continuer à apprendre.` });
      else if (loss / g.length >= 0.7) out.push({ h: "Adversaire trop fort ?", t: `${loss} défaites sur ${g.length}. Baisse un peu le niveau pour jouer des parties où tu peux appliquer ce que tu apprends.` });
    }
    if (idleDays >= 3) out.push({ h: "Régularité", t: `Plus d'entraînement depuis ${idleDays} jours. 10 minutes de puzzles par jour valent mieux qu'une longue séance par semaine.`, go: { tab: "puzzles" } });
    if (!out.length) out.push({ h: "Commence par quelques puzzles", t: "Résous une dizaine de puzzles et analyse une de tes parties : ETO pourra alors te donner des conseils précis.", go: { tab: "puzzles" } });
    return out;
  };

  // ------------------------------------------------------------------ données (chargées à la demande : ~3 Mo)
  let dataP = null;
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Données d'apprentissage introuvables (" + src + ")")); document.head.appendChild(s); });
  const data = () => dataP || (dataP = Promise.all([loadScript("data/learn_puzzles.js"), loadScript("data/learn_openings.js")]).then(() => {
    const P = window.ENOS_PUZZLES;
    L.themes = P.themes.map((t) => t[0]); L.themeName = Object.fromEntries(P.themes); L.puzzles = P.p; L.openings = window.ENOS_OPENINGS; L.root = L.trie(L.openings);
  }).catch((e) => { dataP = null; throw e; }));

  // ------------------------------------------------------------------ stockage personnel
  const S = {
    get: (k, d) => E.settings.get("learn." + k, d), set: (k, v) => E.settings.set("learn." + k, v),
    rating() { return this.get("rating", 1000); },
    stats() { return this.get("stats", {}); },
  };
  const today = () => Math.floor(Date.now() / 86400000);
  E.chessLearn = {
    /** appelé par play.js quand une analyse de partie est terminée */
    addReview(r) {
      try {
        const me = r.review.me, list = S.get("reviews", []);
        list.push({ t: Date.now(), acc: me.accuracy, elo: me.elo, counts: me.counts || {}, opening: r.opening || "", me: r.me });
        S.set("reviews", list.slice(-30));
      } catch (e) { /* analyse sans bilan : rien à retenir */ }
    },
    /** appelé par play.js quand une partie contre le moteur se termine */
    addGame(me, over, power) {
      const won = (me === "w" ? /les Blancs gagnent/ : /les Noirs gagnent/).test(over), lost = (me === "w" ? /les Noirs gagnent/ : /les Blancs gagnent/).test(over);
      const list = S.get("games", []); list.push({ t: Date.now(), result: won ? "win" : lost ? "loss" : "draw", power }); S.set("games", list.slice(-40));
    },
  };

  // ------------------------------------------------------------------ leçons (écrites pour ENOS ; thèmes = identifiants Lichess)
  const LESSONS = [
    ["Les principes d'ouverture", "opening", "Contrôle le centre avec les pions (e4, d4), sors tes cavaliers puis tes fous, fais le roque tôt, ne bouge pas deux fois la même pièce sans raison et ne sors pas la dame trop vite. Une ouverture est réussie quand tes pièces sont actives et ton roi en sécurité."],
    ["La fourchette", "fork", "Une seule pièce attaque deux cibles à la fois (le cavalier est le roi des fourchettes). L'adversaire ne peut en sauver qu'une. Cherche les cases d'où ton cavalier ou ton pion touche le roi et une pièce non protégée."],
    ["Le clouage", "pin", "Une pièce ne peut pas bouger car elle protège une pièce plus précieuse derrière elle (clouage absolu si c'est le roi). Attaque la pièce clouée avec un pion : elle ne peut pas s'échapper."],
    ["L'enfilade", "skewer", "Le contraire du clouage : tu attaques la pièce la plus précieuse, elle doit s'écarter, et tu prends celle qui se cachait derrière. Typique des tours et fous sur une ligne ouverte."],
    ["L'attaque à la découverte", "discoveredAttack", "Tu déplaces une pièce pour libérer l'attaque d'une autre. Si la pièce qui bouge crée elle-même une menace (échec, attaque de la dame), l'adversaire ne peut pas répondre aux deux : très puissant."],
    ["Le mat du couloir", "backRankMate", "Le roi enfermé derrière ses propres pions est maté par une tour ou une dame sur la dernière rangée. Crée une « lucarne » (un pion avancé d'une case) pour t'en protéger, et cherche ce motif chez l'adversaire."],
    ["La déviation et l'attraction", "deflection", "Déviation : tu forces une pièce défensive à quitter son poste. Attraction : tu attires une pièce (souvent le roi) sur une case où elle sera frappée. Demande-toi toujours : qui défend la case clé, et comment l'en éloigner ?"],
    ["Le coup intermédiaire", "intermezzo", "Au lieu de la réponse attendue (reprendre), tu intercales un coup plus fort, souvent un échec ou une menace, avant de reprendre. Avant de recapturer automatiquement, cherche un échec ou une capture meilleure."],
    ["Le Gambit Alien", "opening", "Une ouverture-piège des Blancs contre la Caro-Kann : 1.e4 c6 2.d4 d5 3.Nc3 dxe4 4.Nxe4 Nf6 5.Ng5 h6? 6.Nxf7!? Le cavalier prend f7 pour attirer le roi au centre et l'empêcher de roquer ; tu comptes ensuite sur Bc4, Qf3 et Bf4 pour exploiter les cases blanches. Objectivement douteux : avec une pièce de plus et une défense précise, les Noirs s'en sortent. Pour le contrer : ne joue pas 5...h6 (préfère 5...e6 ou 5...Bf5, développe vite et roque), ou évite la ligne avec 1...c5. Contre un joueur de moins de 1500 Elo, en blitz, il fait des dégâts. Tu le trouves dans OUVERTURES ; Nasko le joue contre la Caro-Kann."],
    ["Le sacrifice", "sacrifice", "Donner du matériel pour une attaque de mat, un gain de matériel plus grand ou une position dominante. Un sacrifice se calcule : avant de le jouer, vérifie les coups forcés (échecs, captures, menaces de mat) jusqu'au bout."],
    ["Le roi exposé", "exposedKing", "Un roi sans abri de pions est une cible. Ouvre les lignes (sacrifice de pion, poussée), amène la dame et un cavalier, et chaque échec doit avoir un but. Défends-toi en roquant et en gardant les pions devant ton roi."],
    ["Pièces en prise", "hangingPiece", "Beaucoup de parties se perdent sur des pièces laissées sans protection. Avant chaque coup : liste les pièces de l'adversaire non protégées et les tiennes. Une pièce en prise, c'est un cadeau ou une gaffe."],
    ["Les finales de pions", "endgame", "Roi actif, opposition, pion passé : le roi est une pièce de combat en finale. Rapproche-le du centre, cherche à créer un pion passé et compte les tempos avant de te lancer dans une course."],
    ["Le mat en 2 et 3", "mateIn2", "Cherche d'abord les coups forcés : les échecs, puis les menaces de mat. Un mat en 2 commence presque toujours par un coup qui laisse un seul coup légal à l'adversaire. Visualise la position finale avant de calculer."],
  ];

  // ------------------------------------------------------------------ interface
  E.suite.register({
    id: "learn", group: "chess", title: "Apprendre", sub: "Puzzles · ouvertures · conseils",
    icon: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/>',
    build(el, A) {
      const $ = (s) => el.querySelector(s), B = E.board;
      el.innerHTML = `<div class="lrn-tabs" id="lr-tabs"><button data-t="puzzles" class="on">PUZZLES</button><button data-t="openings">OUVERTURES</button><button data-t="lessons">LEÇONS</button><button data-t="advice">CONSEILS</button></div>
        <div id="lr-puzzles"></div><div id="lr-openings" hidden></div><div id="lr-lessons" hidden></div><div id="lr-advice" hidden></div>`;
      let tab = "puzzles";
      const show = (t, opt) => {
        tab = t;
        el.querySelectorAll("#lr-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
        ["puzzles", "openings", "lessons", "advice"].forEach((x) => { $("#lr-" + x).hidden = x !== t; });
        data().then(() => { if (t === "puzzles") pz.open(opt); if (t === "openings") op.open(); if (t === "lessons") lessons(); if (t === "advice") advice(); })
          .catch((e) => { $("#lr-" + t).innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p></div>`; });
      };
      $("#lr-tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.t); };

      // ---------------------------------------------------------------- PUZZLES
      const pz = (() => {
        const Z = { theme: "", p: null, ch: null, moves: [], idx: 0, color: "w", hints: 0, failed: false, done: false, sel: "", busy: false, flip: false, last: null, hint: null, brill: false, streak: 0, session: [0, 0] };
        const root = $("#lr-puzzles"); L._z = Z;                  // exposé pour les tests
        let built = false;
        const build = () => {
          built = true;
          root.innerHTML = `<div class="card" style="padding:12px">
            <div class="ch-top"><span id="pz-status" class="muted">…</span><span class="chip" id="pz-rate"></span></div>
            <div class="lrn-chips" id="pz-themes"></div>
            <div id="pz-board"></div>
            <div class="lrn-info" id="pz-info"></div>
            <div class="row"><button class="btn" id="pz-hint">INDICE</button><button class="btn" id="pz-skip">SOLUTION</button><button class="btn pri" id="pz-next">SUIVANT</button></div>
            <div class="row" style="margin-top:8px"><button class="btn" id="pz-eto">DEMANDER À ETO</button></div>
            <div class="lrn-say" id="pz-say" hidden></div></div>`;
          $("#pz-hint").onclick = hint; $("#pz-skip").onclick = giveUp; $("#pz-next").onclick = () => next();
          $("#pz-eto").onclick = askEto;
          $("#pz-themes").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; Z.theme = b.dataset.t; themeChips(); next(); };
          themeChips();
        };
        const THEME_SHORT = ["", "brilliant", "mateIn1", "mateIn2", "fork", "pin", "skewer", "discoveredAttack", "hangingPiece", "backRankMate", "deflection", "endgame", "sacrifice"];
        const themeChips = () => {
          $("#pz-themes").innerHTML = THEME_SHORT.map((t) => `<button data-t="${t}" class="${Z.theme === t ? "on" : ""}">${t === "" ? "Tous" : t === "brilliant" ? "✦ Brillants" : esc(L.themeName[t])}</button>`).join("");
        };
        const pool = () => {
          const t = Z.theme;
          if (!t) return L.puzzles;
          if (t === "brilliant") return L.puzzles.filter((p) => p[4].includes(L.themes.indexOf("sacrifice")) || p[4].includes(L.themes.indexOf("smotheredMate")));
          const i = L.themes.indexOf(t);
          return L.puzzles.filter((p) => p[4].includes(i));
        };
        const pick = () => {
          const list = pool(), r = S.rating(), seen = new Set(S.get("seen", []));
          for (const w of [120, 250, 500, 4000]) {
            const c = list.filter((p) => Math.abs(p[3] - r) <= w && !seen.has(p[0]));
            if (c.length) return c[Math.floor(Math.random() * c.length)];
          }
          return list[Math.floor(Math.random() * list.length)];
        };
        const paint = (anim) => {
          const pos = B.parse(Z.ch.fen()), targets = Z.sel ? Z.ch.moves({ square: Z.sel, verbose: true }).map((m) => m.to) : [];
          B.render($("#pz-board"), pos.m, { flip: Z.flip, last: Z.last, hint: Z.hint, sel: Z.sel, targets, check: Z.ch.in_check() ? B.kingSquare(pos.m, pos.turn) : "", onTap, anim });
          $("#pz-rate").textContent = `Niveau ${S.rating()}`;
        };
        const info = (html) => { $("#pz-info").innerHTML = html; };
        const status = (t) => { $("#pz-status").textContent = t; };
        const play = async (uci, animate) => {
          const m = Z.ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
          Z.last = [uci.slice(0, 2), uci.slice(2, 4)]; Z.sel = ""; Z.hint = null;
          if (m) E.chessSound.forSan(m.san);
          paint(animate ? uci : "");
          return m;
        };
        async function next() {
          if (!built) build();
          Z.recorded = null; Z.p = pick(); Z.moves = Z.p[2].split(" "); Z.ch = new Chess(Z.p[1]); Z.idx = 0; Z.hints = 0; Z.failed = false; Z.done = false; Z.sel = ""; Z.hint = null; Z.last = null; Z.busy = true;
          $("#pz-say").hidden = true;
          const seen = S.get("seen", []); seen.push(Z.p[0]); S.set("seen", seen.slice(-500));
          const first = Z.moves[0];
          Z.color = Z.ch.turn() === "w" ? "b" : "w"; Z.flip = Z.color === "b";
          paint(); status("Observe la position…"); info("");
          await E.sleep(650);
          await play(first, true); Z.idx = 1;
          Z.brill = L.isSacrifice(Z.ch.fen(), Z.moves[1]);
          Z.busy = false;
          status(`Trouve le meilleur coup pour les ${Z.color === "w" ? "Blancs" : "Noirs"}`);
          info(`<span class="chip">Difficulté ${Z.p[3]}</span>` + (Z.session[0] ? ` <span class="chip">Série ${Z.streak} · ${Z.session[1]}/${Z.session[0]}</span>` : ""));
          paint();
        }
        function onTap(sq) {
          if (Z.busy || Z.done || !Z.ch) return;
          const pos = B.parse(Z.ch.fen()), p = pos.m[sq];
          if (Z.sel) {
            const mv = Z.ch.moves({ square: Z.sel, verbose: true }).find((m) => m.to === sq);
            if (mv) return attempt(mv);
          }
          if (p && (p === p.toUpperCase()) === (Z.color === "w")) { Z.sel = sq; Z.hint = null; E.vibrate(6); } else Z.sel = "";
          paint();
        }
        async function attempt(mv) {
          let promo = mv.promotion ? "q" : "";
          if (mv.flags.includes("p")) promo = await new Promise((res) => E.ui.sheet({ title: "Promotion", options: [["q", "Dame"], ["r", "Tour"], ["b", "Fou"], ["n", "Cavalier"]].map(([c, n]) => ({ label: n, fn: () => res(c) })), onClose: () => res("q") }));
          const uci = mv.from + mv.to + promo, want = Z.moves[Z.idx];
          const test = new Chess(Z.ch.fen()); test.move({ from: mv.from, to: mv.to, promotion: promo || undefined });
          if (uci === want || test.in_checkmate()) {
            Z.busy = true;
            await play(uci, true); Z.idx++;
            if (Z.idx >= Z.moves.length || test.in_checkmate()) return solved();
            status("Bien ! Continue…"); E.vibrate(10);
            await E.sleep(450);
            await play(Z.moves[Z.idx], true); Z.idx++;
            if (Z.idx >= Z.moves.length) return solved();
            Z.busy = false; paint();
          } else {
            Z.sel = ""; Z.failed = true; E.vibrate(30); E.chessSound.play("illegal");
            status("Ce n'est pas le bon coup — essaie encore"); paint();
            record(false);
          }
        }
        function record(ok) {
          if (Z.recorded) return;
          Z.recorded = Z.p[0];
          const before = S.rating(), assisted = Z.failed || Z.hints > 0, after = L.rate(before, Z.p[3], ok && !assisted ? 1 : 0);
          S.set("rating", after);
          const st = S.stats();
          Z.p[4].forEach((i) => { const t = L.themes[i]; const a = st[t] || [0, 0]; a[0]++; if (ok && !assisted) a[1]++; st[t] = a; });
          S.set("stats", st); S.set("last", today());
          Z.session[0]++; if (ok && !assisted) { Z.session[1]++; Z.streak++; } else Z.streak = 0;
          Z.delta = after - before;
        }
        function solved() {
          Z.done = true; Z.busy = false; record(true);
          const assisted = Z.failed || Z.hints > 0;
          const brilliant = Z.brill && !assisted;
          status(brilliant ? "✦ Coup brillant !!" : assisted ? "Résolu avec aide" : "Résolu !");
          E.vibrate(brilliant ? 40 : 20); E.chessSound.play(brilliant ? "promote" : "move");
          const ths = Z.p[4].filter((i) => !GENERIC.has(L.themes[i])).map((i) => `<span class="chip">${esc(L.themeName[L.themes[i]])}</span>`).join(" ");
          info(`${brilliant ? '<div class="lrn-brill">!! Sacrifice brillant : tu as donné du matériel pour gagner.</div>' : ""}<span class="chip">${Z.delta >= 0 ? "+" : ""}${Z.delta} → ${S.rating()}</span> ${ths}`);
          paint();
        }
        function hint() {
          if (Z.busy || Z.done || !Z.ch) return;
          const u = Z.moves[Z.idx]; Z.hints++;
          Z.hint = Z.hints === 1 ? [u.slice(0, 2)] : [u.slice(0, 2), u.slice(2, 4)]; Z.sel = ""; paint();
          status(Z.hints === 1 ? "Indice : cette pièce doit bouger" : "Indice : voici le coup");
        }
        async function giveUp() {
          if (Z.busy || Z.done || !Z.ch) return;
          Z.failed = true; record(false); Z.busy = true; Z.hint = null;
          status("Voici la solution");
          while (Z.idx < Z.moves.length) { await play(Z.moves[Z.idx], true); Z.idx++; await E.sleep(700); }
          Z.busy = false; Z.done = true;
          info(`<span class="chip">${Z.delta} → ${S.rating()}</span> ` + Z.p[4].filter((i) => !GENERIC.has(L.themes[i])).map((i) => `<span class="chip">${esc(L.themeName[L.themes[i]])}</span>`).join(" "));
          paint();
        }
        function askEto() {
          const box = $("#pz-say");
          if (!Z.p) return;
          if (!E.ai.configured()) { box.hidden = false; box.textContent = "ETO n'est pas disponible ici (sur le téléphone : ajoute ta clé Groq dans Réglages → Clés d'API)."; return; }
          const persona = E.settings.get("persona", "enos") === "eto" ? "eto" : "enos";
          const th = Z.p[4].map((i) => L.themeName[L.themes[i]]).join(", ");
          const san = (() => { const c = new Chess(Z.p[1]); return Z.moves.map((u) => { const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); return m ? m.san : u; }).join(" "); })();
          const q = `Puzzle d'échecs (thèmes : ${th}). Position de départ (FEN) : ${Z.p[1]}. Solution complète en notation SAN, le premier coup étant celui de l'adversaire : ${san}. ${Z.done ? "Le joueur a fini le puzzle." : "Le joueur cherche encore : ne donne PAS la solution, donne seulement une piste sur l'idée."} Explique en 3 phrases simples l'idée tactique.`;
          box.hidden = false; box.textContent = "…";
          E.ai.chat(persona, q, () => {}, { oneShot: true, system: E.ai.PERSONAS[persona].system(E.ai.name()) + " Tu es un entraîneur d'échecs pédagogue. Réponse courte, en français." })
            .then((t) => { box.textContent = t; box.onclick = () => E.ai.speak(persona, t); }).catch((e) => { box.textContent = e.message; });
        }
        return {
          open(opt) { if (opt && opt.theme != null) Z.theme = opt.theme; if (!built) build(); themeChips(); if (!Z.p || (opt && opt.theme != null)) next(); else paint(); },
        };
      })();

      // ---------------------------------------------------------------- OUVERTURES
      const op = (() => {
        const O = { path: [], ch: null, flip: false, mode: "explore", color: "w", busy: false, sel: "", last: null };
        const root = $("#lr-openings");
        let built = false;
        const CURATED = [
          ["Gambit Alien (contre la Caro-Kann)", "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Ng5 h6 Nxf7", "Ouverture agressive et non officielle : après 5.Ng5 h6?, les Blancs sacrifient le cavalier en f7 (6.Nxf7) pour chasser le roi noir au centre. Piège redoutable sous 1500 Elo, mais douteux contre une bonne défense."],
          ["Italienne (Giuoco Piano)", "e4 e5 Nf3 Nc6 Bc4 Bc5", "Développement rapide et attaque sur f7. Idéale pour débuter : plan c3 + d4 pour prendre le centre."],
          ["Espagnole (Ruy Lopez)", "e4 e5 Nf3 Nc6 Bb5", "La reine des ouvertures classiques : pression sur le cavalier c6 qui défend e5. Jeu positionnel riche."],
          ["Gambit Dame", "d4 d5 c4", "Tu offres un pion pour dominer le centre. Les Noirs peuvent accepter ou refuser (Slave, Orthodoxe)."],
          ["Défense sicilienne", "e4 c5", "La réponse la plus ambitieuse à 1.e4 : déséquilibre immédiat et contre-attaque côté dame."],
          ["Défense française", "e4 e6 d4 d5", "Structure de pions solide, jeu stratégique. Les Noirs préparent ...c5 pour attaquer le centre."],
          ["Caro-Kann", "e4 c6 d4 d5", "Très solide : le fou des Noirs sort avant ...e6. Parfait pour jouer sans risque."],
          ["Système Londres", "d4 d5 Bf4", "Mise en place simple et sûre pour les Blancs : e3, Nf3, c3, Bd3. Peu de théorie à apprendre."],
          ["Indienne du roi", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6", "Les Noirs laissent le centre aux Blancs puis le contre-attaquent avec ...e5 ou ...c5."],
          ["Gambit du roi", "e4 e5 f4", "Ouverture romantique : les Blancs sacrifient un pion pour une attaque rapide."],
          ["Anglaise", "c4", "Flexible : contrôle d5 depuis le flanc et peut transposer vers beaucoup de structures."],
        ];
        const build = () => {
          built = true;
          root.innerHTML = `<div class="card" style="padding:12px">
            <div class="ch-top"><span id="op-name" class="muted">Position de départ</span><span class="chip" id="op-eco"></span></div>
            <div id="op-board"></div>
            <div class="lrn-info" id="op-msg"></div>
            <div class="lrn-moves" id="op-path"></div>
            <div class="row"><button class="btn" id="op-back">◂ COUP</button><button class="btn" id="op-reset">DÉPART</button><button class="btn" id="op-flip">RETOURNER</button></div>
            <div class="row" style="margin-top:8px"><button class="btn pri" id="op-train">S'ENTRAÎNER</button><button class="btn" id="op-stop" hidden>ARRÊTER</button></div></div>
            <div class="card"><h3>Coups du livre<span class="sp" id="op-cnt"></span></h3><div class="lrn-next" id="op-next"></div></div>
            <div class="card"><h3>Ouvertures à connaître</h3><div class="list" id="op-pop"></div></div>
            <div class="card"><h3>Chercher une ouverture</h3><input type="text" id="op-q" placeholder="Ex. Najdorf, Scandinave, Caro…" autocapitalize="off" spellcheck="false"><div class="list" id="op-res" style="margin-top:8px"></div></div>`;
          $("#op-pop").innerHTML = CURATED.map((c, i) => `<div class="it" data-c="${i}"><span class="n">${esc(c[0])}<small>${esc(c[2])}</small></span><span class="tag">VOIR</span></div>`).join("");
          $("#op-pop").onclick = (e) => { const it = e.target.closest("[data-c]"); if (it) setLine(CURATED[+it.dataset.c][1].split(" ")); };
          $("#op-back").onclick = () => { if (O.busy) return; O.path.pop(); if (O.mode === "train" && O.path.length && !mine()) O.path.pop(); refresh(); };
          $("#op-reset").onclick = () => { if (O.busy) return; O.path = []; if (O.mode === "train") startTrain(); else refresh(); };
          $("#op-flip").onclick = () => { O.flip = !O.flip; refresh(); };
          $("#op-train").onclick = trainSheet; $("#op-stop").onclick = () => { O.mode = "explore"; O.busy = false; refresh(); };
          $("#op-next").onclick = (e) => { const b = e.target.closest("[data-s]"); if (b && O.mode === "explore") { O.path.push(b.dataset.s); sound(b.dataset.s); refresh(); } };
          $("#op-q").oninput = (e) => {
            const q = e.target.value.trim().toLowerCase();
            $("#op-res").innerHTML = q.length < 3 ? "" : L.openings.filter((o) => o[1].toLowerCase().includes(q)).slice(0, 14).map((o, i) => `<div class="it" data-l="${esc(o[2])}"><span class="n">${esc(o[1])}<small>${esc(o[0])} · ${esc(o[2])}</small></span><span class="tag">VOIR</span></div>`).join("") || '<div class="muted">Aucun résultat.</div>';
          };
          $("#op-res").onclick = (e) => { const it = e.target.closest("[data-l]"); if (it) setLine(it.dataset.l.split(" ")); };
        };
        const node = () => { let n = L.root; for (const s of O.path) { n = n && n.c[s]; } return n; };
        const sound = (san) => E.chessSound.forSan(san);
        const mine = () => (O.path.length % 2 === 0) === (O.color === "w");   // c'est à moi de jouer (entraînement)
        const replay = () => { const ch = new Chess(); for (const s of O.path) ch.move(s); return ch; };
        function setLine(line) {
          const ch = new Chess(), ok = [];
          for (const s of line) { if (!ch.move(s)) break; ok.push(s); }
          O.mode = "explore"; O.path = ok; O.busy = false; refresh(); $("#op-board").scrollIntoView({ behavior: "smooth", block: "center" });
        }
        function refresh(anim) {
          if (!built) build();
          O.ch = replay();
          const n = node(), nm = L.nameAt(L.root, O.path), pos = B.parse(O.ch.fen());
          const lastSan = O.path.length ? O.ch.history({ verbose: true }).slice(-1)[0] : null;
          O.last = lastSan ? [lastSan.from, lastSan.to] : null;
          const targets = O.sel ? O.ch.moves({ square: O.sel, verbose: true }).map((m) => m.to) : [];
          B.render($("#op-board"), pos.m, { flip: O.flip, last: O.last, sel: O.sel, targets, check: O.ch.in_check() ? B.kingSquare(pos.m, pos.turn) : "", onTap, anim });
          $("#op-name").textContent = nm ? nm[1] : O.path.length ? "Hors des noms connus" : "Position de départ";
          $("#op-eco").textContent = nm ? nm[0] : "";
          $("#op-eco").hidden = !nm;
          $("#op-path").innerHTML = O.path.map((s, i) => `<span>${i % 2 === 0 ? (i / 2 + 1) + "." : ""}${esc(s)}</span>`).join("");
          $("#op-train").hidden = O.mode === "train"; $("#op-stop").hidden = O.mode !== "train";
          const kids = n ? Object.entries(n.c).sort((a, b) => b[1].n - a[1].n) : [];
          $("#op-cnt").textContent = n ? n.n + " ligne" + (n.n > 1 ? "s" : "") : "";
          if (O.mode === "train") $("#op-next").innerHTML = `<div class="muted">Mode entraînement : joue sur le plateau le bon coup du livre. ${kids.length ? "" : "Fin de la théorie."}</div>`;
          else $("#op-next").innerHTML = kids.length ? kids.slice(0, 12).map(([s, k]) => `<button class="lrn-mv" data-s="${esc(s)}"><b>${esc(s)}</b><small>${k.name ? esc(k.name[1].split(": ").slice(-1)[0]) : k.n + " lignes"}</small></button>`).join("") : '<div class="muted">Fin de la théorie connue pour cette ligne.</div>';
        }
        function onTap(sq) {
          if (O.busy) return;
          const pos = B.parse(O.ch.fen()), p = pos.m[sq];
          if (O.mode === "train" && !mine()) return;
          if (O.sel) {
            const mv = O.ch.moves({ square: O.sel, verbose: true }).find((m) => m.to === sq);
            if (mv) return tryMove(mv);
          }
          if (p && (p === p.toUpperCase()) === (pos.turn === "w")) { O.sel = sq; E.vibrate(6); } else O.sel = "";
          refresh();
        }
        async function tryMove(mv) {
          const n = node(), san = mv.promotion ? mv.san : mv.san;
          O.sel = "";
          if (n && n.c[san]) {
            O.path.push(san); sound(san); refresh(mv.from + mv.to);
            if (O.mode === "train") await trainReply();
          } else if (O.mode === "train") {
            E.vibrate(30); E.chessSound.play("illegal");
            const good = n ? Object.entries(n.c).sort((a, b) => b[1].n - a[1].n).slice(0, 3).map(([s]) => s).join(", ") : "";
            $("#op-msg").innerHTML = `<div class="lrn-bad">✕ ${esc(san)} n'est pas dans le livre. Coups attendus : <b>${esc(good)}</b></div>`; refresh();
          } else {
            O.path.push(san); sound(san); refresh(mv.from + mv.to);
            $("#op-msg").innerHTML = '<div class="lrn-bad">Coup hors du livre : l\'explorateur s\'arrête ici.</div>';
          }
        }
        async function trainReply() {
          const n = node();
          if (!n || !Object.keys(n.c).length) return done();
          O.busy = true; await E.sleep(550);
          const kids = Object.entries(n.c), tot = kids.reduce((s, [, k]) => s + k.n, 0);
          let r = Math.random() * tot, pick = kids[0][0];
          for (const [s, k] of kids) { r -= k.n; if (r <= 0) { pick = s; break; } }
          const before = replay(); const m = before.move(pick);
          O.path.push(pick); sound(pick); O.busy = false; refresh(m.from + m.to);
          const nn = node();
          if (!nn || !Object.keys(nn.c).length) done();
        }
        function done() {
          const nm = L.nameAt(L.root, O.path);
          $("#op-msg").innerHTML = `<div class="lrn-brill">✔ Ligne terminée${nm ? " : " + esc(nm[1]) : ""}. Relance pour essayer une autre variante.</div>`;
        }
        function startTrain() {
          O.mode = "train"; O.path = []; O.busy = false; O.sel = ""; O.flip = O.color === "b"; $("#op-msg").innerHTML = ""; refresh();
          if (O.color === "b") trainReply();
        }
        function trainSheet() {
          const s = E.ui.sheet({ title: "S'entraîner", html: `<p class="muted" style="margin-bottom:12px">Joue les coups du livre. L'adversaire répond avec les variantes les plus jouées.</p>
            <div class="seg" id="tr-seg" style="margin-bottom:14px"><button data-c="w" class="on">BLANCS</button><button data-c="b">NOIRS</button><i class="seg-ind"></i></div>
            <div class="row"><button class="btn pri" id="tr-go">COMMENCER</button></div>` });
          const seg = s.querySelector("#tr-seg"); let c = "w";
          seg.querySelectorAll("button").forEach((b) => (b.onclick = () => { c = b.dataset.c; seg.dataset.p = c === "w" ? "enos" : "eto"; seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); }));
          s.querySelector("#tr-go").onclick = () => { E.ui.closeSheet(); O.color = c; startTrain(); };
        }
        return { open() { if (!built) { build(); refresh(); } } };
      })();

      // ---------------------------------------------------------------- LEÇONS
      function lessons() {
        const st = S.stats();
        $("#lr-lessons").innerHTML = LESSONS.map((l, i) => {
          const a = st[l[1]], pct = a && a[0] ? Math.round(a[1] / a[0] * 100) : null;
          return `<div class="card"><h3>${esc(l[0])}<span class="sp">${pct == null ? "" : pct + " % réussi"}</span></h3><p class="lrn-text">${esc(l[2])}</p>
            <div class="row"><button class="btn" data-go="${l[1]}">${l[1] === "opening" ? "VOIR LES OUVERTURES" : "S'ENTRAÎNER"}</button></div></div>`;
        }).join("");
        $("#lr-lessons").onclick = (e) => { const b = e.target.closest("[data-go]"); if (!b) return; if (b.dataset.go === "opening") show("openings"); else show("puzzles", { theme: LESSONS.find((l) => l[1] === b.dataset.go)[1] }); };
      }

      // ---------------------------------------------------------------- CONSEILS
      function advice() {
        const last = S.get("last", 0), tips = L.advice({ stats: S.stats(), names: L.themeName, reviews: S.get("reviews", []), games: S.get("games", []), rating: S.rating(), idleDays: last ? today() - last : 0 });
        const st = S.stats(), total = Object.values(st).reduce((s, [a]) => s + a, 0);
        $("#lr-advice").innerHTML = `<div class="card"><h3>Ton niveau<span class="sp">puzzles</span></h3><div class="rv-stats"><div><small>CLASSEMENT</small><b>${S.rating()}</b></div><div><small>PUZZLES</small><b>${new Set(S.get("seen", [])).size}</b></div><div><small>ANALYSES</small><b>${S.get("reviews", []).length}</b></div></div></div>
          ${tips.map((t, i) => `<div class="card"><h3>${esc(t.h)}</h3><p class="lrn-text">${esc(t.t)}</p>${t.go ? `<div class="row"><button class="btn" data-tip="${i}">${t.go.tab === "openings" ? "VOIR LES OUVERTURES" : "S'ENTRAÎNER"}</button></div>` : ""}</div>`).join("")}
          <div class="card"><h3>Plan d'ETO</h3><p class="lrn-text" id="ad-plan">${total < 5 ? "Fais quelques puzzles d'abord, puis demande ton plan de la semaine." : "ETO résume tes progrès et te prépare un plan sur 7 jours."}</p><div class="row"><button class="btn pri" id="ad-ask">MON PLAN DE LA SEMAINE</button></div></div>`;
        $("#lr-advice").onclick = (e) => {
          const b = e.target.closest("[data-tip]");
          if (b) { const g = tips[+b.dataset.tip].go; show(g.tab, g.tab === "puzzles" ? { theme: g.theme || "" } : undefined); }
        };
        $("#ad-ask").onclick = () => {
          const box = $("#ad-plan");
          if (!E.ai.configured()) { box.textContent = "ETO n'est pas disponible ici (sur le téléphone : ajoute ta clé Groq dans Réglages → Clés d'API)."; return; }
          const persona = E.settings.get("persona", "enos") === "eto" ? "eto" : "enos";
          const summary = tips.map((t) => t.h + " : " + t.t).join("\n");
          box.textContent = "…";
          E.ai.chat(persona, `Voici le bilan d'un joueur d'échecs (classement puzzles ${S.rating()}) :\n${summary}\nÉcris un plan d'entraînement sur 7 jours (10 à 20 minutes par jour), concret, motivant, en français, sans liste à puces trop longue.`, () => {}, { oneShot: true, system: E.ai.PERSONAS[persona].system(E.ai.name()) + " Tu es son entraîneur d'échecs personnel." })
            .then((t) => { box.textContent = t; }).catch((e) => { box.textContent = e.message; });
        };
      }
      show("puzzles");
    },
  });
})();
