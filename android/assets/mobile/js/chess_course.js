"use strict";
// COURS EN DIRECT : ETO joue une ouverture (ou résout une tactique) devant toi contre un adversaire de ton choix et t'explique ce qu'il pense.
//  - À chaque carrefour (plusieurs coups de théorie possibles, pour lui OU pour l'adversaire) il joue l'option n°1 sous tes yeux, la déjoue, joue la n°2, etc. (flèches à l'appui),
//    puis garde la principale pour la vraie partie. Après chaque décision il demande si tu as compris (COMPRIS / EXPLIQUE ENCORE / REVOIR).
//  - « INTERROMPRE ETO » à tout moment : il te propose de jouer toi-même la même ouverture. Il joue alors l'adversaire et SURVEILLE tes coups (coup hors théorie ou franchement mauvais -> il te prévient, tu peux annuler).
// Sources : arbre des ouvertures Lichess (CC0) + Stockfish du téléphone ; explications écrites localement, enrichies par le LLM d'ETO si une clé est configurée. Aucun PC requis.
(() => {
  const E = window.ENOS, $ = E.$, esc = E.esc, U = E.ui, B = E.board, K = E.brain, L = E.learnLib, T = E.chessTools, sleep = T.sleep;
  const C = { tok: 0, ch: null, side: "w", elo: 1200, kind: "open", mode: "idle", title: "", line: [], voice: false, sel: "", arrows: null, badge: null, askRes: null, pz: null, tries: 0, practiceNote: "" };

  // ------------------------------------------------------------------ vocabulaire / données
  const FR = [["Queen's Gambit Accepted", "Gambit Dame accepté"], ["Queen's Gambit Declined", "Gambit Dame refusé"], ["Queen's Gambit", "Gambit Dame"], ["King's Gambit", "Gambit du Roi"], ["Declined", "refusé"], ["Accepted", "accepté"],
    ["Sicilian Defense", "Défense sicilienne"], ["French Defense", "Défense française"], ["Caro-Kann Defense", "Défense Caro-Kann"], ["Scandinavian Defense", "Défense scandinave"], ["Italian Game", "Partie italienne"], ["Ruy Lopez", "Espagnole (Ruy Lopez)"],
    ["English Opening", "Ouverture anglaise"], ["King's Indian Defense", "Indienne du roi"], ["Queen's Indian Defense", "Indienne de la dame"], ["Nimzo-Indian Defense", "Nimzo-indienne"], ["London System", "Système de Londres"],
    ["Defense", "Défense"], ["Defence", "Défense"], ["Opening", "Ouverture"], ["Game", "Partie"], ["Attack", "Attaque"], ["Variation", "Variante"], ["Gambit", "Gambit"], ["Exchange", "Échange"], ["Line", "Ligne"], ["Main Line", "Ligne principale"], ["Italian", "italienne"], ["Sicilian", "sicilienne"], ["French", "française"]];
  const fr = (n) => { let s = String(n || ""); for (const [a, b] of FR) s = s.split(a).join(b); return s; };
  const QFR = [["gambit dame", "queen's gambit"], ["gambit du roi", "king's gambit"], ["gambit roi", "king's gambit"], ["sicilienne", "sicilian"], ["francaise", "french"], ["espagnole", "ruy lopez"], ["italienne", "italian"], ["anglaise", "english"], ["indienne", "indian"], ["defense", "defense"], ["ouverture", "opening"], ["scandinave", "scandinavian"], ["londres", "london"], ["refuse", "declined"], ["accepte", "accepted"], ["slave", "slav"]];
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const toEn = (q) => { let s = norm(q); for (const [a, b] of QFR) s = s.split(a).join(b); return s; };

  // Quelques ouvertures phares : [titre, coups de départ, camp d'ETO, idée]
  const CURATED = [
    ["Gambit Dame", "d4 d5 c4", "w", "Je propose un pion pour dominer le centre."],
    ["Système de Londres", "d4 d5 Bf4", "w", "Une mise en place simple et solide, presque sans théorie."],
    ["Partie italienne", "e4 e5 Nf3 Nc6 Bc4", "w", "Développement rapide et pression sur f7."],
    ["Espagnole (Ruy Lopez)", "e4 e5 Nf3 Nc6 Bb5", "w", "Pression sur le défenseur du pion e5."],
    ["Gambit du Roi", "e4 e5 f4", "w", "Un pion sacrifié pour une attaque rapide."],
    ["Ouverture anglaise", "c4", "w", "Contrôle de d5 depuis le flanc, très flexible."],
    ["Défense sicilienne (Noirs)", "e4 c5", "b", "La contre-attaque la plus combative contre 1.e4."],
    ["Défense française (Noirs)", "e4 e6 d4 d5", "b", "Structure solide, contre-jeu avec ...c5."],
    ["Caro-Kann (Noirs)", "e4 c6 d4 d5", "b", "Très solide : le fou sort avant ...e6."],
    ["Indienne du roi (Noirs)", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6", "b", "On laisse le centre aux Blancs puis on le contre-attaque."],
    ["Défense slave (Noirs)", "d4 d5 c4 c6", "b", "Soutenir d5 avec c6 sans enfermer le fou dame."],
  ];
  const PLANS = [
    [/Queen's Gambit/i, "Le Gambit Dame n'est pas un vrai sacrifice : si les Noirs prennent c4, je reprends le pion sans mal. Le but est d'écarter le pion d5 pour occuper le centre avec e4. Plan : développer Cc3 et Cf3, sortir le fou, roquer, puis jouer e4."],
    [/London/i, "Le Londres est un système : fou en f4 AVANT e3, puis e3, Cf3, c3, Fd3, Cbd2 et roque. On joue presque les mêmes coups contre tout, il y a très peu de théorie."],
    [/Italian|Giuoco/i, "Le fou en c4 vise f7, le point faible de départ des Noirs. Plan : c3 et d4 pour construire un grand centre, roquer vite, et garder des pièces actives."],
    [/Ruy Lopez/i, "Le fou en b5 attaque le cavalier c6, qui défend e5. La tension est surtout positionnelle : on maintient la pression et on construit le centre petit à petit."],
    [/King's Gambit/i, "On sacrifie le pion f pour ouvrir la colonne f et attaquer le roi. C'est tranchant : il faut développer vite et ne pas laisser les Noirs garder le pion en sécurité."],
    [/English/i, "c4 contrôle d5 sans occuper le centre : on garde plein de choix (transpositions vers le Gambit Dame, structures de Sicilienne à l'envers…)."],
    [/Sicilian/i, "1...c5 refuse la symétrie : les Noirs échangent un pion de flanc contre le pion central des Blancs. Les positions sont déséquilibrées : chacun joue sur une aile."],
    [/French/i, "Les Noirs bâtissent la chaîne e6-d5 et attaquent le centre avec ...c5. Le point faible est le fou c8, qu'il faut libérer."],
    [/Caro-Kann/i, "Comme la Française mais en gardant le fou c8 actif : ...c6 prépare ...d5. Très solide, peu de risques."],
    [/Indian/i, "Les Noirs laissent le centre aux Blancs, développent leurs pièces et le contre-attaquent plus tard (...e5 ou ...c5)."],
    [/Slav/i, "...c6 soutient d5 sans bloquer le fou dame, qui sort en f5 ou g4 avant ...e6."],
    [/Scandinavian/i, "...d5 contre immédiatement le centre. La dame sort tôt : il faut la mettre à l'abri sans perdre de temps."],
  ];
  const planOf = (name) => { const p = PLANS.find(([re]) => re.test(name || "")); return p ? p[1] : ""; };
  const THEMES = {
    mateIn1: "Mat en 1 : cherche chaque échec et vérifie que le roi n'a aucune case de fuite.",
    mateIn2: "Mat en 2 : un coup forcé (souvent un échec ou une menace de mat) puis le mat. On compte les cases de fuite du roi.",
    mateIn3: "Mat en 3 : on enchaîne des coups forcés ; on réduit les cases du roi à chaque coup.",
    fork: "Fourchette : une seule pièce attaque deux cibles en même temps ; l'adversaire ne peut en sauver qu'une.",
    pin: "Clouage : une pièce ne peut pas bouger car elle protège une pièce plus précieuse derrière elle.",
    skewer: "Enfilade : on attaque une grosse pièce qui doit s'écarter, ce qui laisse tomber la pièce derrière.",
    discoveredAttack: "Attaque à la découverte : on déplace une pièce pour dévoiler l'attaque d'une autre ; le coup déplacé crée souvent une 2e menace.",
    hangingPiece: "Pièce en prise : une pièce est mal protégée ; on la prend ou on la gagne par une menace.",
    trappedPiece: "Pièce piégée : toutes ses cases de fuite sont contrôlées ; on l'attaque jusqu'à la capturer.",
    sacrifice: "Sacrifice : on donne du matériel pour obtenir bien plus (mat, dame, attaque décisive).",
    backRankMate: "Mat du couloir : le roi est enfermé derrière ses propres pions ; une tour ou une dame sur la dernière rangée donne mat.",
    smotheredMate: "Mat étouffé : le roi est entouré par ses propres pièces et un cavalier donne échec.",
    deflection: "Déviation : on force une pièce défensive à quitter son poste pour exploiter ce qu'elle protégeait.",
    attraction: "Attraction : on attire une pièce (souvent le roi) sur une case où elle sera attaquée.",
    clearance: "Dégagement : on libère une case ou une ligne pour une autre pièce.",
    intermezzo: "Coup intermédiaire : au lieu de la reprise attendue, on insère un coup plus fort (souvent un échec).",
    doubleCheck: "Double échec : deux pièces donnent échec ; seul le roi peut répondre en bougeant.",
    quietMove: "Coup tranquille : ni échec ni capture, mais il prépare une menace imparable.",
    endgame: "Finale : peu de pièces, chaque tempo compte ; le roi devient une pièce active.",
    promotion: "Promotion : le pion atteint la dernière rangée ; il devient une dame (ou mieux selon la position).",
    zugzwang: "Zugzwang : l'adversaire doit jouer et tout coup aggrave sa position.",
    xRayAttack: "Rayons X : une pièce attaque « à travers » une autre.",
    capturingDefender: "Prise du défenseur : on enlève la pièce qui protège la cible.",
    exposedKing: "Roi exposé : le roi est mal protégé, on l'attaque avec toutes les pièces disponibles.",
  };
  const PNAME = { p: "pion", n: "cavalier", b: "fou", r: "tour", q: "dame", k: "roi" };
  const ART = { p: "un pion", n: "un cavalier", b: "un fou", r: "une tour", q: "une dame", k: "le roi" };
  const COLN = { w: "Blancs", b: "Noirs" };
  const powerOfElo = (e) => Math.max(1, Math.min(100, Math.round(e <= 1500 ? 1 + (e - 250) / 1250 * 49 : 50 + (e - 1500) / 1700 * 50)));
  const uciOf = (m) => m.from + m.to + (m.promotion || "");
  const live = (tok) => C.tok === tok;

  // ------------------------------------------------------------------ données (arbre des ouvertures, puzzles)
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = (E.assetBase || "") + src; s.onload = res; s.onerror = () => rej(new Error("Données introuvables (" + src + ")")); document.head.appendChild(s); });
  async function data(needPuzzles) {
    if (!window.ENOS_OPENINGS) await loadScript("data/learn_openings.js");
    L.openings = L.openings || window.ENOS_OPENINGS; if (!L.root) L.root = L.trie(L.openings);
    if (needPuzzles && !L.puzzles) { if (!window.ENOS_PUZZLES) await loadScript("data/learn_puzzles.js"); const P = window.ENOS_PUZZLES; L.themes = P.themes.map((t) => t[0]); L.themeName = Object.fromEntries(P.themes); L.puzzles = P.p; }
  }
  const pathNow = () => C.ch.history();
  const nodeAt = (path) => { let n = L.root; for (const s of path) { n = n && n.c[s]; if (!n) return null; } return n; };
  const nameOf = (path) => { if (C.kind !== "open") return ""; const nm = L.nameAt(L.root, path); return nm ? nm[1] : ""; };
  const kidsOf = (path) => { const n = C.kind === "open" ? nodeAt(path) : null; return n ? Object.entries(n.c).sort((a, b) => b[1].n - a[1].n) : []; };
  /** Coups notables d'un carrefour : le plus joué + ceux qui pèsent au moins 20 % de lui (3 au plus). */
  const altsOf = (path) => { const k = kidsOf(path); if (!k.length) return []; const top = k[0][1].n; return k.filter(([, v], i) => i === 0 || (v.n >= 2 && v.n >= top * 0.2)).slice(0, 3).map(([s]) => s); };
  /** Suite la plus jouée à partir de path+[san] : n demi-coups au plus. */
  const mainLine = (path, san, n) => { const out = [san]; let node = nodeAt(path.concat(san)); while (node && out.length < n) { const k = Object.entries(node.c).sort((a, b) => b[1].n - a[1].n)[0]; if (!k) break; out.push(k[0]); node = k[1]; } return out; };

  // ------------------------------------------------------------------ explications
  function describe(fen, san) {
    const c = new Chess(fen), m = c.move(san); if (!m) return "";
    const p = PNAME[m.piece], me = COLN[m.color], map = B.parse(c.fen()).m, att = B.attacks(map, m.to).map((s) => `${ART[map[s].toLowerCase()]} en ${s}`);
    const out = [];
    if (m.flags.includes("k") || m.flags.includes("q")) out.push(`Je roque ${m.flags.includes("k") ? "côté roi" : "côté dame"} : le roi se met à l'abri et la tour rejoint le jeu.`);
    else if (m.piece === "p" && ["d4", "e4", "d5", "e5"].includes(m.to)) out.push(`Ce pion s'installe au centre (${m.to}) : il donne de l'espace à mes pièces et en prive celles de l'adversaire.`);
    else if (m.piece === "p" && /^[bcf][3-6]$/.test(m.to)) out.push(`Ce pion en ${m.to} attaque le centre depuis le flanc et prépare mes pièces.`);
    else if (m.piece === "p") out.push(`Ce pion avance en ${m.to} pour gagner de l'espace ou ouvrir une ligne.`);
    else if ((m.piece === "n" || m.piece === "b") && "18".includes(m.from[1])) out.push(`Je développe mon ${p} en ${m.to} : une pièce qui sort du camp est une pièce qui participe.`);
    else if (m.piece === "q" && c.history().length < 14) out.push("La dame sort tôt : à ce stade c'est rarement bon, il faut qu'elle ait une vraie cible.");
    else out.push(`Mon ${p} va en ${m.to}.`);
    if (m.captured) out.push(`Je capture ${ART[m.captured]} en ${m.to}.`);
    if (att.length) out.push(`Il attaque ${att.slice(0, 2).join(" et ")}.`);
    if (c.in_checkmate()) out.push("Échec et mat !"); else if (c.in_check()) out.push("Il donne échec.");
    return out.join(" ");
  }
  async function llm(system, q) {
    if (!(E.ai && E.ai.configured())) return "";
    try { return (await Promise.race([E.ai.chat("eto", q, () => {}, { oneShot: true, system: E.ai.PERSONAS.eto.system(E.ai.name()) + " " + system }), sleep(9000).then(() => "")])) || ""; } catch (e) { return ""; }
  }

  // ------------------------------------------------------------------ interface
  function say(title, html, tone) {
    const box = $("#co-say");
    box.className = "co-say" + (tone ? " " + tone : "");
    box.innerHTML = `<div class="co-st">${title}</div><div class="co-sb">${html}</div>`;
    if (C.voice) { try { E.ai.stopVoice(); E.ai.speak("eto", box.textContent); } catch (e) { /* voix facultative */ } }
  }
  const status = (t) => { $("#co-open").textContent = t; };
  function paint(anim, extra) {
    const el = $("#co-board"), ch = C.ch, pos = B.parse(ch.fen()), hist = ch.history({ verbose: true }), lm = hist[hist.length - 1];
    const targets = C.sel ? ch.moves({ square: C.sel, verbose: true }).map((m) => m.to) : [];
    B.render(el, pos.m, { flip: C.side === "b", last: lm ? [lm.from, lm.to] : null, sel: C.sel, targets, check: ch.in_check() ? B.kingSquare(pos.m, pos.turn) : "", arrows: C.arrows, badge: C.badge, anim, onTap: C.mode === "practice" ? onTap : null, ...(extra || {}) });
    const nm = L.root ? nameOf(hist.map((m) => m.san)) : "";
    status(nm ? fr(nm) : C.title);
    $("#co-moves").innerHTML = hist.map((m, i) => `<span>${i % 2 === 0 ? (i / 2 + 1) + "." : ""}${esc(m.san)}</span>`).join("");
    $("#co-moves").scrollLeft = 1e5;
  }
  function ask(tok, labels) {
    const box = $("#co-ask");
    labels = labels || [["ok", "✔ COMPRIS, SUITE ▸"], ["more", "? EXPLIQUE ENCORE"], ["replay", "↺ REVOIR"]];
    box.innerHTML = `<div class="co-q">As-tu compris ? Dis-moi s'il y a un point flou.</div><div class="row">${labels.map(([k, t]) => `<button class="btn${k === "ok" ? " pri" : ""}" data-k="${k}">${t}</button>`).join("")}</div>`;
    box.hidden = false; box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return new Promise((res) => {
      const done = (v) => { box.hidden = true; C.askRes = null; res(v); };
      C.askRes = done;
      box.onclick = (e) => { const b = e.target.closest("button[data-k]"); if (b) done(b.dataset.k); };
    });
  }
  async function playReal(san, hold) {
    const m = C.ch.move(san); if (!m) throw new Error("Coup illégal : " + san);
    C.arrows = null; C.badge = null;
    try { E.chessSound.forSan(m.san); } catch (e) { /* son facultatif */ }
    paint(uciOf(m)); await sleep(hold || 900); return m;
  }
  /** Joue une ligne (SAN) depuis la position actuelle avec flèches, puis la déjoue coup par coup. */
  async function demoLine(sans, tok, hold) {
    const el = $("#co-board"), flip = C.side === "b", w = new Chess(C.ch.fen()), fens = [w.fen()], ucis = [];
    for (const s of sans) { const m = w.move(s); if (!m) break; ucis.push(uciOf(m)); fens.push(w.fen()); }
    const hist = C.ch.history({ verbose: true }), lm = hist[hist.length - 1], last0 = lm ? [lm.from, lm.to] : null;
    for (let i = 0; i < ucis.length; i++) {
      if (!live(tok)) return false;
      const u = ucis[i], pos = B.parse(fens[i + 1]), arrows = [{ from: u.slice(0, 2), to: u.slice(2, 4), color: i % 2 === 0 ? B.ARROW.alt : B.ARROW.threat }];
      if (i === 0) B.attacks(pos.m, u.slice(2, 4)).forEach((s) => arrows.push({ from: u.slice(2, 4), to: s, color: B.ARROW.target, w: 0.1, alpha: 0.8 }));
      B.render(el, pos.m, { flip, last: [u.slice(0, 2), u.slice(2, 4)], arrows, anim: u });
      try { E.chessSound.forSan(sans[i]); } catch (e) { /* son facultatif */ }
      await sleep(i === 0 ? (hold || 1700) : 1000);
    }
    await sleep(500);
    for (let i = ucis.length; i > 0; i--) {
      if (!live(tok)) return false;
      const u = ucis[i - 1], prev = i > 1 ? ucis[i - 2] : null;
      B.render(el, B.parse(fens[i - 1]).m, { flip, last: prev ? [prev.slice(0, 2), prev.slice(2, 4)] : last0, anim: u.slice(2, 4) + u.slice(0, 2) });
      await sleep(380);
    }
    paint(); return true;
  }

  // ------------------------------------------------------------------ le cours : ouverture
  /** Présente chaque option d'un carrefour (jouée puis déjouée). who : "mine" (mon coup) | "opp" (ses réponses possibles). */
  async function presentAlts(alts, who, tok, linesOf) {
    const path = pathNow(), nameP = nameOf(path), side = COLN[C.ch.turn()];
    for (let again = true; again && live(tok);) {
      again = false;
      say(`${who === "mine" ? "Je réfléchis" : "Ce que peut jouer l'adversaire"} — ${alts.length} possibilités`, `${who === "mine" ? `Position clé : plusieurs coups de théorie existent pour les ${side}.` : `Les ${side} ont plusieurs réponses courantes ici.`} Je te les montre une par une, puis je reviens à la position.${nameP ? `<br><span class="muted">${esc(fr(nameP))}</span>` : ""}`);
      await sleep(1600);
      for (let i = 0; i < alts.length && live(tok); i++) {
        const san = alts[i], nm = fr(nameOf(path.concat(san)) || ""), line = linesOf ? linesOf(san) : mainLine(path, san, 5), nd = linesOf ? null : nodeAt(path.concat(san)), pop = nd ? nd.n : 0;
        say(`Option ${i + 1}/${alts.length} : <b>${esc(san)}</b>`, `${nm && nm !== fr(nameP) ? `<b>${esc(nm)}</b><br>` : ""}${esc(describe(C.ch.fen(), san))}<br><span class="muted">${linesOf ? "Suite prévue" : "Suite habituelle"} : ${esc(line.slice(1).join(" ") || "—")}${pop ? ` · ${pop} partie${pop > 1 ? "s" : ""} de référence` : ""}.</span>${planOf(nm || nameP) && i === 0 ? `<br><br>${esc(planOf(nm || nameP))}` : ""}`);
        if (!(await demoLine(line, tok))) return null;
        await sleep(500);
      }
      if (!live(tok)) return null;
      say("On revient à la position", `Je retiens <b>${esc(alts[0])}</b> : ${linesOf ? "c'est celui que le moteur préfère" : "c'est le coup le plus joué et le plus sûr"}${who === "opp" ? " (l'adversaire jouera ce que son niveau lui dicte)" : ""}.`);
      const r = await ask(tok);
      if (r === "stop" || !live(tok)) return null;
      if (r === "replay") again = true;
      if (r === "more") { say("Pourquoi ?", "<span class=\"co-wait\"><i></i> ETO réfléchit…</span>"); const t = await llm("Explique à un débutant en 4 phrases simples (français, tutoiement) pourquoi ces coups sont les options de théorie et en quoi ils diffèrent.", `Ouverture : ${fr(nameP) || "début de partie"}. Position (FEN) : ${C.ch.fen()}. Options pour les ${side} : ${alts.join(", ")}. Principale : ${alts[0]}.`); say("Pourquoi ?", esc(t || `Chaque option poursuit un plan différent. ${alts[0]} est la plus jouée car elle respecte les principes : occuper le centre, développer les pièces, protéger le roi. Les autres sont des alternatives valables mais plus spécifiques.`)); await sleep(500); const r2 = await ask(tok); if (r2 === "replay") again = true; if (r2 === "stop") return null; }
    }
    return live(tok) ? alts[0] : null;
  }

  async function explainAfter(san, fenBefore, tok, intro, extra) {
    const nm = fr(nameOf(pathNow())), base = describe(fenBefore, san);
    const plan = planOf(nameOf(pathNow()));
    say(`${intro || "Je joue"} <b>${esc(san)}</b>`, `${esc(base)}${nm ? `<br><span class="muted">${esc(nm)}</span>` : ""}${plan ? `<br><br>${esc(plan)}` : ""}${extra ? `<br><br>${extra}` : ""}`);
  }

  async function askMore(fenBefore, san, tok) {
    say("Je t'explique plus en détail", '<span class="co-wait"><i></i> ETO réfléchit…</span>');
    const nm = fr(nameOf(pathNow()));
    let t = await llm("Explique à un joueur de niveau moyen, en 4 à 5 phrases simples (français, tutoiement), POURQUOI ce coup est joué dans cette ouverture : l'idée, les menaces, ce qu'il évite.", `Ouverture : ${nm || "inconnue"}. Position avant le coup (FEN) : ${fenBefore}. Coup joué : ${san}.`);
    if (!t) {
      const ev = await K.evaluate(new Chess(fenBefore).fen(), 450).catch(() => null);
      t = `${describe(fenBefore, san)} Les principes de l'ouverture : occuper le centre, développer cavaliers et fous, mettre le roi à l'abri, ne pas bouger deux fois la même pièce sans raison. ${ev ? "Le moteur évalue la position à " + K.fmt(ev.w) + " (en centipions, du point de vue des Blancs)." : ""}`;
    }
    say("Plus en détail", esc(t));
  }

  /** Une décision d'ETO (son coup) : explication, coup réel, puis « as-tu compris ? ». Retourne false si interrompu. */
  async function etoMove(san, tok, o) {
    o = o || {};
    const fenBefore = C.ch.fen();
    await explainAfter(san, fenBefore, tok, o.intro, o.extra); await sleep(800);
    if (!live(tok)) return false;
    await playReal(san, 700); if (!live(tok)) return false;
    if (o.brilliant) { const hs = C.ch.history({ verbose: true }), m = hs[hs.length - 1]; C.badge = { sq: m.to, key: "brilliant", id: "g" + hs.length }; paint(); await sleep(1800); }
    for (;;) {
      const r = await ask(tok);
      if (r === "stop" || !live(tok)) return false;
      if (r === "ok") return true;
      if (r === "more") await askMore(fenBefore, san, tok);
      if (r === "replay") { C.ch.undo(); C.badge = null; paint(); await sleep(400); await explainAfter(san, fenBefore, tok, o.intro, o.extra); await sleep(600); await playReal(san, 600); }
      if (!live(tok)) return false;
    }
  }

  const P_BOOK = { 400: 0.35, 800: 0.55, 1200: 0.75, 1600: 0.9, 2000: 0.97 };
  /** Coup de l'adversaire : théorie pondérée (plus le niveau est faible, plus il en sort tôt) ou Stockfish bridé. -> {san, book} */
  async function oppChoice() {
    const path = pathNow(), kids = kidsOf(path);
    if (kids.length && C.kind === "open" && Math.random() < (P_BOOK[C.elo] || 0.75)) {
      const alts = kids.slice(0, 4), tot = alts.reduce((s, [, v]) => s + v.n, 0);
      let r = Math.random() * tot, pick = alts[0][0];
      for (const [s, v] of alts) { r -= v.n; if (r <= 0) { pick = s; break; } }
      return { san: pick, book: true };
    }
    const r = await E.chessLocal.call("/api/mobile/chess/engine", { fen: C.ch.fen(), power: powerOfElo(C.elo), seen: E.chessLocal.startSeen(C.ch.fen()) });
    return { san: r.reply.san, book: false };
  }
  async function etoEngineMove() {
    const lines = await E.chessLocal.lines(C.ch.fen(), 1, 1100);
    return lines.length ? K.san(C.ch.fen(), lines[0].uci) : null;
  }

  async function runOpening(tok) {
    const mineTurn = () => C.ch.turn() === C.side;
    let introDone = C.ch.history().length > 0;
    if (!introDone) {
      const plan = planOf(C.title) || planOf(nameOf(C.line));
      say(`Cours : ${esc(C.title)}`, `Je joue les <b>${COLN[C.side]}</b> contre un adversaire de <b>${C.elo} Elo</b>.${plan ? `<br><br>${esc(plan)}` : ""}<br><br>Je commente chaque coup. Aux carrefours, je te montre toutes les options. Tu peux m'interrompre à tout moment pour jouer toi-même.`);
      const r = await ask(tok, [["ok", "▶ COMMENCER"]]); if (r === "stop" || !live(tok)) return;
    }
    while (live(tok) && !C.ch.game_over()) {
      const path = pathNow(), inPrefix = path.length < C.line.length;
      if (mineTurn()) {
        let san = inPrefix ? C.line[path.length] : null;
        if (!san) {
          const alts = altsOf(path);
          if (alts.length > 1) { san = await presentAlts(alts, "mine", tok); if (!san) return; }
          else if (alts.length) san = alts[0];
          else {                                                                   // hors théorie : Stockfish
            say("Nous sortons de la théorie", '<span class="co-wait"><i></i> Je cherche le meilleur coup…</span>');
            san = await etoEngineMove(); if (!san) break;
            if (!live(tok)) return;
          }
        }
        if (!(await etoMove(san, tok))) return;
      } else {
        const alts = !inPrefix ? altsOf(path) : [];
        if (alts.length > 1 && path.length < 14) { const s = await presentAlts(alts, "opp", tok); if (!s) return; }
        let san, book = true;
        if (inPrefix) san = C.line[path.length]; else { const r = await oppChoice(); san = r.san; book = r.book; }
        if (!live(tok)) return;
        const nm = fr(nameOf(path.concat(san)) || "");
        say(`L'adversaire (${C.elo} Elo) joue <b>${esc(san)}</b>`, `${book ? (nm ? `C'est la variante <b>${esc(nm)}</b>.` : "C'est un coup de théorie.") : "Il sort de la théorie : à ce niveau, ça arrive. Je vais le punir en jouant simplement des coups solides."}`);
        await sleep(900); await playReal(san, 800);
      }
    }
    if (!live(tok)) return;
    finish(tok);
  }
  function finish(tok) {
    C.mode = "done";
    const over = C.ch.in_checkmate() ? `Échec et mat : les ${COLN[C.ch.turn() === "w" ? "b" : "w"]} gagnent !` : C.ch.game_over() ? "Partie nulle." : "La théorie s'arrête ici.";
    say("Fin du cours", `${over}<br>Maintenant, à toi : tu veux refaire cette ouverture toi-même pendant que je te surveille ?`);
    sheetEnd();
  }

  // ------------------------------------------------------------------ le cours : tactique
  async function pickPuzzle(theme) {
    await data(true);
    const i = theme ? L.themes.indexOf(theme) : -1, rating = E.settings.get("learn.rating", 1000);
    let list = i >= 0 ? L.puzzles.filter((p) => p[4].includes(i)) : L.puzzles;
    for (const w of [150, 300, 600, 4000]) { const c = list.filter((p) => Math.abs(p[3] - rating) <= w); if (c.length) return c[Math.floor(Math.random() * c.length)]; }
    return list[Math.floor(Math.random() * list.length)];
  }
  async function startTactic(theme) {
    const p = await pickPuzzle(theme), tok = ++C.tok;
    C.kind = "tactic"; C.startFen = ""; C.mode = "course"; C.pz = { fen: p[1], moves: p[2].split(" "), rating: p[3], themes: p[4].map((k) => L.themes[k]).filter((t) => THEMES[t]) };
    const first = new Chess(p[1]).turn();
    C.side = first === "w" ? "b" : "w";                                           // l'adversaire joue d'abord ; ETO résout
    C.ch = new Chess(p[1]); C.title = "Tactique : " + (theme ? L.themeName[theme] : "au hasard"); C.elo = 1200; C.line = []; C.sel = ""; C.arrows = null; C.badge = null;
    showMain(); paint();
    const th = C.pz.themes.slice(0, 2);
    say(`Tactique — ${esc(th.map((t) => L.themeName[t]).join(", ") || "à trouver")}`, `${th.map((t) => esc(THEMES[t])).join("<br>") || "Cherche les coups forcés : échecs, captures, menaces."}<br><br>Je joue les <b>${COLN[C.side]}</b> (difficulté ${C.pz.rating}).`);
    const r = await ask(tok, [["ok", "▶ COMMENCER"]]); if (r === "stop" || !live(tok)) return;
    await sleep(300); await playUci(C.pz.moves[0]);                              // coup de l'adversaire qui crée la position
    say("Voici la position", "L'adversaire vient de jouer. Je cherche le coup décisif…"); await sleep(1500);
    for (let i = 1; i < C.pz.moves.length && live(tok); i += 2) {
      const u = C.pz.moves[i], fenBefore = C.ch.fen(), san = K.san(fenBefore, u);
      const nextPos = B.applyUci(B.parse(fenBefore), u), tg = B.attacks(nextPos, u.slice(2, 4));
      C.arrows = [{ from: u.slice(0, 2), to: u.slice(2, 4), color: B.ARROW.best }].concat(tg.map((s) => ({ from: u.slice(2, 4), to: s, color: B.ARROW.target, w: 0.1, alpha: 0.8 }))); paint();
      const th2 = C.pz.themes[0] ? THEMES[C.pz.themes[0]] : "";
      say(`Le coup : <b>${esc(san)}</b>`, `${esc(describe(fenBefore, san))}${th2 ? `<br><br><span class="muted">${esc(th2)}</span>` : ""}`);
      await sleep(1600); if (!live(tok)) return;
      await playReal(san, 700);
      if (C.ch.in_checkmate()) { say("Échec et mat !", "C'est le but de la tactique."); }
      for (;;) {
        const a = await ask(tok); if (a === "stop" || !live(tok)) return;
        if (a === "ok") break;
        if (a === "more") { say("Plus en détail", '<span class="co-wait"><i></i> ETO réfléchit…</span>'); const t = await llm("Explique en 4 phrases simples (français, tutoiement) pourquoi ce coup gagne dans cette tactique.", `Position avant (FEN) : ${fenBefore}. Coup : ${san}. Thèmes : ${C.pz.themes.join(", ")}.`); say("Plus en détail", esc(t || `${describe(fenBefore, san)} Regarde les flèches : elles montrent ce que le coup attaque. L'adversaire ne peut pas tout défendre à la fois.`)); }
        if (a === "replay") { C.ch.undo(); C.arrows = null; paint(); await sleep(500); C.arrows = [{ from: u.slice(0, 2), to: u.slice(2, 4), color: B.ARROW.best }]; paint(); await sleep(1200); await playReal(san, 600); }
      }
      if (C.pz.moves[i + 1] && live(tok)) { await sleep(400); await playUci(C.pz.moves[i + 1]); }
    }
    if (live(tok)) { C.mode = "done"; say("Tactique terminée", "Tu veux la résoudre toi-même ? Je te surveille."); sheetEnd(); }
  }
  async function playUci(u) {
    const m = C.ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); if (!m) return;
    C.arrows = null; try { E.chessSound.forSan(m.san); } catch (e) { /* son facultatif */ }
    paint(uciOf(m)); await sleep(800);
  }

  // ------------------------------------------------------------------ prise en main : ETO joue cette partie
  /** ETO prend les commandes à partir de `fen` : il joue `opts.side` (défaut : le camp au trait), l'adversaire joue au niveau `opts.elo`. */
  async function startGame(fen, opts) {
    opts = opts || {};
    await data(false);
    let ch; try { ch = new Chess(fen || undefined); } catch (e) { throw new Error("Position invalide."); }
    const side = opts.side || ch.turn();
    Object.assign(C, { kind: "game", mode: "course", title: "Partie reprise par ETO", line: [], side, elo: opts.elo || +E.settings.get("course.elo", 1200), ch, startFen: ch.fen(), sel: "", arrows: null, badge: null, busy: false });
    ensureUi(); $("#course-ov").hidden = false;
    const tok = ++C.tok; showMain(); paint();
    runGame(tok).catch(fail);
  }
  /** Choix d'ETO dans une position libre : un coup brillant s'il existe, sinon le meilleur ; les alternatives presque équivalentes sont renvoyées pour être montrées. */
  async function gamePick() {
    const fen = C.ch.fen(), n = Math.min(4, C.ch.moves().length);
    const [h, lines] = await Promise.all([K.hunt(fen, { multipv: 3, topMs: 800, sacMs: 1500, tolerance: 40 }).catch(() => null), E.chessLocal.lines(fen, n, 1300)]);
    if (!lines.length) return null;
    const top = Math.min(1000, lines[0].cp), brill = h && h.sacrifices.find((s) => s.brilliant);
    const near = lines.filter((l) => top - Math.min(1000, l.cp) <= 30).slice(0, 3);
    const best = brill ? { uci: brill.uci, san: brill.san, pv: brill.pv, cp: brill.score, brilliant: true } : { uci: lines[0].uci, san: K.san(fen, lines[0].uci), pv: lines[0].pv, cp: lines[0].cp };
    return { best, alts: brill ? [] : near.map((l) => ({ uci: l.uci, san: K.san(fen, l.uci), pv: l.pv })), fen };
  }
  async function runGame(tok) {
    const mineTurn = () => C.ch.turn() === C.side;
    if (!C.ch.history().length) {
      say("Je prends la main", `Je joue les <b>${COLN[C.side]}</b> à ta place, face à un adversaire de <b>${C.elo} Elo</b>. Je t'explique chaque coup : ce que je vois, ce que je menace et ce que je crains. Aux carrefours, je te montre les options. <b>Interromps-moi</b> quand tu veux jouer toi-même.`);
      const r = await ask(tok, [["ok", "▶ COMMENCER"]]); if (r === "stop" || !live(tok)) return;
    }
    while (live(tok) && !C.ch.game_over()) {
      if (mineTurn()) {
        say("Je réfléchis…", '<span class="co-wait"><i></i> analyse de la position</span>');
        const g = await gamePick(); if (!live(tok)) return; if (!g) break;
        let san = g.best.san;
        if (g.alts.length > 1) {
          const lines = Object.fromEntries(g.alts.map((a) => [a.san, K.sanLine(g.fen, a.pv, 5)]));
          const pick = await presentAlts(g.alts.map((a) => a.san), "mine", tok, (s2) => lines[s2]); if (!pick) return; san = pick;
        }
        const pvSan = K.sanLine(g.fen, g.best.pv, 5), w = g.fen.split(" ")[1] === "w" ? g.best.cp : -g.best.cp;
        const ev = Math.abs(w) >= 90000 ? "mat forcé" : (w >= 0 ? "+" : "−") + (Math.abs(w) / 100).toFixed(1).replace(".", ",");
        const extra = `<span class="muted">Évaluation du moteur : ${ev} (Blancs). Suite prévue : ${esc(pvSan.slice(0, 5).join(" ") || "—")}.</span>${g.best.brilliant ? "<br><b>✨ Coup brillant :</b> je sacrifie du matériel parce que la suite rapporte plus." : ""}`;
        if (!(await etoMove(san, tok, { extra, brilliant: !!g.best.brilliant && san === g.best.san, intro: g.best.brilliant ? "Je trouve" : "Je joue" }))) return;
      } else {
        const r = await oppChoice(); if (!live(tok)) return;
        say(`L'adversaire (${C.elo} Elo) joue <b>${esc(r.san)}</b>`, esc(describe(C.ch.fen(), r.san).replace(/^Je /, "Il ").replace(/ mon /g, " son ").replace(/ mes /g, " ses "))); await sleep(900);
        await playReal(r.san, 800);
        const hs = C.ch.history({ verbose: true }), m = hs[hs.length - 1], thr = B.attacks(B.parse(C.ch.fen()).m, m.to);      // menace créée par son coup
        if (thr.length) { C.arrows = thr.map((t) => ({ from: m.to, to: t, color: B.ARROW.threat, w: 0.11 })); paint(); await sleep(1200); C.arrows = null; paint(); }
      }
    }
    if (live(tok)) finish(tok);
  }

  // ------------------------------------------------------------------ interruption -> essai surveillé
  function interrupt() {
    C.tok++; T.stop($("#co-board")); try { E.ai.stopVoice(); } catch (e) { /* rien à couper */ }
    if (C.askRes) C.askRes("stop");
    $("#co-ask").hidden = true;
    if (C.mode === "done" || C.mode === "idle") return sheetEnd();
    const what = C.kind === "tactic" ? "cette tactique" : C.kind === "game" ? "cette partie" : C.title;
    U.sheet({ title: "ETO s'est arrêté", html: `<p class="muted" style="margin-bottom:12px">Veux-tu essayer toi-même <b>${esc(what)}</b> ? Je joue l'adversaire et je te surveille : si tu fais un coup bizarre, je te le dis.</p>
      <div class="row"><button class="btn pri" id="cs-try">JOUER MOI-MÊME</button></div>
      <div class="row" style="margin-top:8px"><button class="btn" id="cs-resume">REPRENDRE LE COURS</button><button class="btn" id="cs-quit">QUITTER</button></div>`, onClose: () => {} });
    const sh = document.querySelector("#cs-try");
    sh.onclick = () => { U.closeSheet(); startPractice(); };
    $("#cs-resume").onclick = () => { U.closeSheet(); resume(); };
    $("#cs-quit").onclick = () => { U.closeSheet(); close(); };
  }
  function sheetEnd() {
    U.sheet({ title: "Et maintenant ?", html: `<div class="row"><button class="btn pri" id="ce-try">ESSAYER MOI-MÊME (avec surveillance)</button></div>
      <div class="row" style="margin-top:8px"><button class="btn" id="ce-again">REFAIRE LE COURS</button><button class="btn" id="ce-menu">AUTRE SUJET</button></div>`, onClose: () => {} });
    $("#ce-try").onclick = () => { U.closeSheet(); startPractice(true); };
    $("#ce-again").onclick = () => { U.closeSheet(); C.kind === "tactic" ? startTactic(C.pz && C.themeKey) : C.kind === "game" ? startGame(C.startFen, { side: C.side, elo: C.elo }) : startOpening(C.title, C.line, C.side, C.elo); };
    $("#ce-menu").onclick = () => { U.closeSheet(); showSetup(); };
  }
  function resume() {
    const tok = ++C.tok; C.mode = "course"; C.sel = ""; C.arrows = null; paint();
    if (C.kind === "tactic") { startTactic(C.themeKey || ""); return; }
    (C.kind === "game" ? runGame(tok) : runOpening(tok)).catch(fail);
  }

  async function startPractice(fromStart) {
    const tok = ++C.tok; C.mode = "practice"; C.sel = ""; C.arrows = null; C.badge = null;
    if (fromStart) { C.ch = C.kind === "tactic" ? new Chess(C.pz.fen) : new Chess(C.startFen || undefined); if (C.kind === "tactic") C.ch.move({ from: C.pz.moves[0].slice(0, 2), to: C.pz.moves[0].slice(2, 4), promotion: C.pz.moves[0][4] }); C.pz && (C.pz.i = 1); }
    else if (C.kind === "tactic") { C.ch = new Chess(C.pz.fen); C.ch.move({ from: C.pz.moves[0].slice(0, 2), to: C.pz.moves[0].slice(2, 4), promotion: C.pz.moves[0][4] }); C.pz.i = 1; }
    C.tries = 0; paint();
    say("À toi de jouer", C.kind === "tactic" ? `Trouve le coup décisif pour les <b>${COLN[C.side]}</b>. Je te surveille.` : `Tu joues les <b>${COLN[C.side]}</b>${C.kind === "game" ? " : continue cette partie" : " : refais <b>" + esc(C.title) + "</b>"}. Je joue l'adversaire (${C.elo} Elo) et je te préviens si ton coup ${C.kind === "game" ? "est une erreur" : "sort de la théorie ou perd du matériel"}.`);
    $("#co-pbar").hidden = false; $("#co-stop").hidden = true;
    if (C.kind !== "tactic" && C.ch.turn() !== C.side && !C.ch.game_over()) await practiceReply(tok);
  }
  async function practiceReply(tok) {
    if (C.ch.game_over()) return practiceEnd();
    C.busy = true; paint();
    await sleep(500);
    const path = pathNow(), inPrefix = path.length < C.line.length;
    let san, book = true;
    if (inPrefix) san = C.line[path.length]; else { const r = await oppChoice(); san = r.san; book = r.book; }
    if (!live(tok)) return;
    await playReal(san, 400);
    C.busy = false; paint();
    if (C.ch.game_over()) return practiceEnd();
    const nm = fr(nameOf(pathNow()) || "");
    if (!book) say("Il sort de la théorie", `Ton adversaire a joué <b>${esc(san)}</b>, hors du livre. Joue des coups solides : développe, protège ton roi, regarde ses menaces.`);
    else say("À toi", `Il joue <b>${esc(san)}</b>${nm ? ` — <b>${esc(nm)}</b>` : ""}. ${kidsOf(pathNow()).length ? "Tu connais la suite ? Sinon demande un indice." : "La théorie s'arrête : joue ton plan."}`);
  }
  function practiceEnd() {
    C.busy = false; paint();
    const mate = C.ch.in_checkmate();
    say("Partie terminée", mate ? (C.ch.turn() !== C.side ? "Bravo, tu as mat !" : "Mat… recommence pour mieux faire.") : "Nulle.");
    U.toast("Essai terminé", "ok", 2500); sheetEnd();
  }
  function onTap(sq) {
    if (C.mode !== "practice" || C.busy) return;
    const ch = C.ch;
    if (ch.turn() !== C.side) return;
    if (C.sel) { const mv = ch.moves({ square: C.sel, verbose: true }).find((m) => m.to === sq); if (mv) return userMove(mv); }
    const p = ch.get(sq);
    C.sel = p && p.color === C.side ? sq : ""; if (C.sel) E.vibrate(6);
    C.arrows = null; paint();
  }
  /** Le coup de l'élève : validé par la théorie (ouverture) ou la solution (tactique), sinon jugé par Stockfish ; ETO prévient et propose d'annuler. */
  async function userMove(mv) {
    const tok = C.tok, ch = C.ch, path = ch.history(), fenBefore = ch.fen(), san = mv.promotion ? mv.san : mv.san;
    C.sel = ""; C.busy = true; C.arrows = null;
    if (C.kind === "tactic") {
      const want = C.pz.moves[C.pz.i], u = uciOf(mv);
      if (u === want) {
        await playReal(san, 500); C.pz.i += 2; C.busy = false;
        say("✔ Exact !", esc(describe(fenBefore, san)));
        if (C.pz.i - 1 >= C.pz.moves.length || ch.in_checkmate()) { say("✔ Tactique réussie !", "Bien joué, tu l'as trouvée" + (C.tries ? ` après ${C.tries} essai${C.tries > 1 ? "s" : ""}.` : " du premier coup !")); E.vibrate([20, 40, 20]); return sheetEnd(); }
        await sleep(500); await playUci(C.pz.moves[C.pz.i - 1]); C.busy = false; paint();
        return;
      }
      C.tries++;
      const m2 = ch.move({ from: mv.from, to: mv.to, promotion: mv.promotion }); try { E.chessSound.forSan(m2.san); } catch (e) { /* son */ } paint(uciOf(m2)); await sleep(600); ch.undo();
      C.arrows = C.tries >= 2 ? [{ from: want.slice(0, 2), to: want.slice(2, 4), color: B.ARROW.best }] : null; C.busy = false; paint();
      say("Pas tout à fait", `${esc(m2.san)} ne fait pas le travail. ${C.tries >= 2 ? "Je te montre le coup en vert : regarde ce qu'il attaque." : "Cherche les échecs, les captures et les menaces. Réessaie !"}`, "warn");
      return;
    }
    const kids = kidsOf(path), inBook = kids.some(([s]) => s === san);
    ch.move({ from: mv.from, to: mv.to, promotion: mv.promotion }); try { E.chessSound.forSan(san); } catch (e) { /* son */ } paint(uciOf(mv));
    let note = "";
    if (inBook) {
      const nm = fr(nameOf(ch.history()));
      say(`✔ ${esc(san)} est dans la théorie`, `${esc(describe(fenBefore, san))}${nm ? `<br><span class="muted">${esc(nm)}</span>` : ""}`);
    } else {
      say("Je vérifie ton coup…", '<span class="co-wait"><i></i> analyse</span>');
      let q = null;
      try {
        const color = fenBefore.split(" ")[1], before = await K.evaluate(fenBefore, 450), after = await K.evaluate(ch.fen(), 450);
        q = (await K.judge(fenBefore, uciOf(mv), before, after, color, 450)).q;
      } catch (e) { /* analyse indisponible : on laisse passer */ }
      if (!live(tok)) return;
      const book = kids.slice(0, 3).map(([s]) => s).join(", ");
      if (q && q.loss > 70) {
        const bad = q.key === "blunder" ? "gaffe" : q.key === "mistake" ? "erreur" : "imprécision";
        C.arrows = [{ from: mv.from, to: mv.to, color: B.ARROW.threat }]; paint();
        say(`⚠ Coup bizarre : ${esc(san)}`, `C'est une <b>${bad}</b> (−${q.loss} cp).${book ? ` Dans cette ouverture, on joue plutôt <b>${esc(book)}</b>.` : ""} Tu veux l'annuler ?`, "warn");
        const r = await ask(tok, [["undo", "↩ ANNULER LE COUP"], ["keep", "GARDER QUAND MÊME"]]);
        if (r === "stop" || !live(tok)) return;
        if (r === "undo") { ch.undo(); C.arrows = null; C.busy = false; paint(); say("Coup annulé", book ? `Essaie plutôt : ${esc(book)}.` : "Réessaie un autre coup."); return; }
        C.arrows = null;
      } else {
        say(`${esc(san)} : hors théorie mais correct`, `${q ? `Le moteur le trouve ${q.key === "best" ? "excellent" : "bon"} (−${q.loss} cp). ` : ""}${book ? `Les coups du livre étaient : <b>${esc(book)}</b>.` : "La théorie s'arrête ici : à toi de jouer ton plan."}`);
      }
    }
    C.busy = false; paint();
    if (ch.game_over()) return practiceEnd();
    await sleep(700); await practiceReply(tok);
  }
  function hintPractice() {
    if (C.mode !== "practice" || C.busy) return;
    if (C.kind === "tactic") { const u = C.pz.moves[C.pz.i]; if (u) { C.arrows = [{ from: u.slice(0, 2), to: u.slice(2, 4), color: B.ARROW.best }]; paint(); say("Indice", "Le coup est en vert. Pense à ce qu'il attaque."); C.tries++; } return; }
    const k = kidsOf(pathNow());
    if (!k.length) { say("Indice", "Plus de théorie ici : joue un coup solide (développement, sécurité du roi)."); return; }
    const w = new Chess(C.ch.fen()), m = w.move(k[0][0]);
    C.arrows = [{ from: m.from, to: m.to, color: B.ARROW.best }]; paint();
    say("Indice", `Dans la théorie on joue <b>${esc(k[0][0])}</b>${k[1] ? ` (ou ${esc(k[1][0])})` : ""}. ${esc(describe(C.ch.fen(), k[0][0]))}`);
  }

  // ------------------------------------------------------------------ écrans
  function fail(e) { say("Oups", esc(e.message || String(e)), "warn"); }
  function ensureUi() {
    if ($("#course-ov")) return;
    const ov = document.createElement("div"); ov.id = "course-ov"; ov.className = "course-ov"; ov.hidden = true;
    ov.innerHTML = `<div class="co-top"><button class="back" id="co-back">◂ QUITTER</button><b>🎓 COURS EN DIRECT</b><button class="chip" id="co-voice" aria-label="Voix d'ETO">🔇</button></div>
      <div class="co-scroll">
      <div id="co-setup"></div>
      <div id="co-main" hidden>
        <div class="co-bar"><span id="co-open" class="muted"></span><span class="chip" id="co-lvl"></span></div>
        <div id="co-board"></div>
        <div class="co-moves" id="co-moves"></div>
        <div class="co-bar2"><button class="btn warn" id="co-stop">⏹ INTERROMPRE ETO</button>
          <div id="co-pbar" class="row" hidden><button class="btn" id="co-hint">INDICE</button><button class="btn" id="co-resumebtn">↺ ETO REPREND</button><button class="btn" id="co-quit2">QUITTER</button></div></div>
        <div class="co-say" id="co-say"></div>
        <div class="co-ask" id="co-ask" hidden></div>
      </div></div>`;
    (document.getElementById("app") || document.body).append(ov);
    $("#co-back").onclick = close;
    $("#co-voice").onclick = () => { C.voice = !C.voice; $("#co-voice").textContent = C.voice ? "🔊" : "🔇"; if (!C.voice) { try { E.ai.stopVoice(); } catch (e) { /* rien */ } } E.settings.set("course.voice", C.voice); };
    $("#co-stop").onclick = interrupt;
    $("#co-hint").onclick = hintPractice;
    $("#co-resumebtn").onclick = () => { $("#co-pbar").hidden = true; $("#co-stop").hidden = false; resume(); };
    $("#co-quit2").onclick = close;
    C.voice = !!E.settings.get("course.voice", false); $("#co-voice").textContent = C.voice ? "🔊" : "🔇";
  }
  function showMain() { $("#co-setup").hidden = true; $("#co-main").hidden = false; $("#co-pbar").hidden = true; $("#co-stop").hidden = false; $("#co-lvl").textContent = C.elo + " Elo"; $("#co-ask").hidden = true; }
  function close() { C.tok++; C.mode = "idle"; T.stop($("#co-board")); try { E.ai.stopVoice(); } catch (e) { /* rien */ } U.closeSheet && U.closeSheet(); const ov = $("#course-ov"); if (ov) ov.hidden = true; if (E.chessCourse && E.chessCourse.onClose) E.chessCourse.onClose(); }

  async function showSetup() {
    C.tok++; C.mode = "idle"; $("#co-main").hidden = true; const box = $("#co-setup"); box.hidden = false;
    box.innerHTML = '<div class="card"><p class="muted">Chargement des ouvertures…</p></div>';
    try { await data(false); } catch (e) { box.innerHTML = `<div class="card"><p class="muted">✕ ${esc(e.message)}</p></div>`; return; }
    let elo = +E.settings.get("course.elo", 1200), side = "auto", kind = "open";
    box.innerHTML = `<div class="card"><h3>Que veux-tu apprendre ?</h3>
        <div class="seg" id="cs-kind" data-p="enos"><button data-k="open" class="on">OUVERTURES</button><button data-k="tactic">TACTIQUES</button><i class="seg-ind"></i></div></div>
      <div class="card"><h3>Adversaire</h3><p class="muted" style="margin-bottom:8px;font-size:14px">ETO joue contre un adversaire de ce niveau.</p>
        <div class="lrn-chips" id="cs-elo">${[400, 800, 1200, 1600, 2000].map((e) => `<button data-e="${e}" class="${e === elo ? "on" : ""}">${e} Elo</button>`).join("")}</div></div>
      <div id="cs-open">
        <div class="card"><h3>Ouvertures conseillées</h3><div class="list" id="cs-cur">${CURATED.map((c, i) => `<div class="it" data-c="${i}"><span class="n">${esc(c[0])}<small>${esc(c[3])}</small></span><span class="tag hot">COURS</span></div>`).join("")}</div></div>
        <div class="card"><h3>Chercher une ouverture</h3><input type="text" id="cs-q" placeholder="Ex. gambit dame, najdorf, scandinave…" autocapitalize="off" spellcheck="false"><div class="list" id="cs-res" style="margin-top:8px"></div></div></div>
      <div id="cs-tac" hidden><div class="card"><h3>Choisis un thème</h3><div class="lrn-chips" style="flex-wrap:wrap" id="cs-th">${["", "mateIn1", "mateIn2", "fork", "pin", "skewer", "discoveredAttack", "backRankMate", "sacrifice", "hangingPiece", "deflection"].map((t) => `<button data-t="${t}">${t ? esc(THEMES[t] ? t.replace(/([A-Z])/g, " $1") : t) : "Au hasard"}</button>`).join("")}</div></div></div>`;
    $("#cs-kind").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; kind = b.dataset.k; $("#cs-kind").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); $("#cs-kind").dataset.p = kind === "open" ? "enos" : "eto"; $("#cs-open").hidden = kind !== "open"; $("#cs-tac").hidden = kind !== "tactic"; };
    $("#cs-elo").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; elo = +b.dataset.e; E.settings.set("course.elo", elo); $("#cs-elo").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); };
    $("#cs-cur").onclick = (e) => { const it = e.target.closest("[data-c]"); if (!it) return; const c = CURATED[+it.dataset.c]; startOpening(c[0], c[1].split(" "), c[2], elo); };
    const blackish = /Defen[cs]e|Indian|Sicilian|Caro|French|Pirc|Scandinavian|Benoni|Dutch|Gr[uü]nfeld|Slav|Modern|Alekhine|Philidor|Petrov|Owen|Nimzowitsch|Budapest|Old Indian/i;
    $("#cs-q").oninput = (e) => {
      const q = toEn(e.target.value.trim());
      const res = q.length < 3 ? [] : L.openings.filter((o) => o[1].toLowerCase().includes(q)).slice(0, 14);
      $("#cs-res").innerHTML = res.map((o, i) => `<div class="it" data-l="${esc(o[2])}" data-n="${esc(o[1])}"><span class="n">${esc(fr(o[1]))}<small>${esc(o[0])} · ${esc(o[2].split(" ").slice(0, 8).join(" "))}</small></span><span class="tag hot">COURS</span></div>`).join("");
    };
    $("#cs-res").onclick = (e) => { const it = e.target.closest("[data-l]"); if (!it) return; const name = it.dataset.n, line = it.dataset.l.split(" "); startOpening(fr(name), line, blackish.test(name) ? "b" : "w", elo); };
    $("#cs-th").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; C.themeKey = b.dataset.t; C.elo = elo; startTactic(b.dataset.t || ""); };
  }

  async function startOpening(title, line, side, elo) {
    await data(false);
    const ch = new Chess(), ok = [];
    for (const s of line) { if (!ch.move(s)) break; ok.push(s); }
    // le cours démarre depuis la position de départ ; les coups imposés (C.line) sont rejoués avec explications
    Object.assign(C, { kind: "open", mode: "course", title, line: ok, side, elo, ch: new Chess(), startFen: "", sel: "", arrows: null, badge: null, busy: false });
    E.settings.set("course.elo", elo);
    const tok = ++C.tok; showMain(); paint();
    runOpening(tok).catch(fail);
  }

  function open() {
    ensureUi(); const ov = $("#course-ov"); ov.hidden = false; showSetup();
  }
  E.chessCourse = { open, close, takeOver: startGame, _C: C, _describe: describe, _alts: altsOf, _fr: fr, _toEn: toEn };
})();
