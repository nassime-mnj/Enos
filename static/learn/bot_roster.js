"use strict";
// ÉCHELLE DES BOTS (107 personnages, pack d'avatars originaux img/roster/ — illustrations, pas les images Chess.com) : de 1 Elo à Magnus Carlsen.
// Chaque bot = un PROFIL DE STYLE joué par Stockfish (comme ai_bots.js) : livre d'ouvertures de son niveau + erreurs calibrées sur son Elo
// (coups au hasard sous 900 Elo, gaffes / erreurs de plus en plus rares en montant). Joueurs réels : profils « inspirés », répliques neutres.
// Mittens affiche 1 Elo… et joue à 3200. Les bots ADAPTATIFS prennent ton niveau (+100 si tu gagnes, −100 si tu perds).
(() => {
  const E = (window.ENOS = window.ENOS || {}), AIP = (window.ENOS_AIPROF = window.ENOS_AIPROF || {});
  const CATS = [["deb", "Débutants"], ["int", "Intermédiaires"], ["adv", "Avancés"], ["mai", "Maîtres"], ["pro", "Joueurs pro"], ["cel", "Célébrités"], ["spe", "Spéciaux"], ["ada", "Adaptatifs"], ["coa", "Coachs"], ["ody", "Odyssée"]];
  // [catégorie, nom, fichier avatar, Elo, sous-titre, id d'un profil existant (ai_bots.js) ou options]
  const R = [
    ["deb", "Noel", "noel", 1, "1 Elo · joue vraiment au hasard"], ["deb", "Oliver", "oliver", 100, "découvre le jeu"], ["deb", "Milica", "milica", 150, "aime pousser les pions"],
    ["deb", "Janjay", "janjay", 200, "sort sa dame très tôt"], ["deb", "Martin", "martin", 250, "le premier pas"], ["deb", "Wayne", "wayne", 250, "attaque sans regarder"],
    ["deb", "Fabian", "fabian", 250, "oublie ses pièces"], ["deb", "Juan", "juan", 300, "joue vite"], ["deb", "Mina", "mina", 350, "prudente, trop prudente"],
    ["deb", "Filip", "filip", 400, "connaît le coup du berger"], ["deb", "Elani", "elani", 400, "apprend les ouvertures"], ["deb", "Zara", "zara", 450, "aime les échecs (au roi)"],
    ["deb", "Santiago", "santiago", 500, "prend tout ce qui traîne"], ["deb", "Karim", "karim", 550, "défense solide… parfois"], ["deb", "Jimmy", "jimmy", 600, "des pièges partout"],
    ["deb", "Zach", "zach", 650, "attaque le roi"], ["deb", "Aron", "aron", 700, "commence à calculer"], ["deb", "June", "june", 750, "développe ses pièces"],
    ["deb", "Pepe", "pepe", 800, "gambits fous"], ["deb", "Robin", "robin", 850, "presque intermédiaire"], ["deb", "Elsa", "elsa", 900, "calme et méthodique"], ["deb", "Emir", "emir", 1000, "le plus dur des débutants"],
    ["int", "Maxim", "maxim", 1000, "positionnel"], ["int", "Azeez", "azeez", 1100, "tactique"], ["int", "Sven", "sven", 1100, "solide"], ["int", "Elena", "elena", 1200, "classique"],
    ["int", "Maria", "maria", 1200, "agressive"], ["int", "Nelson", "nelson", 1300, "sort sa dame tôt, et fort"], ["int", "David", "david", 1400, "méthodique"],
    ["adv", "Antonio", "antonio", 1500, "ouvertures ouvertes"], ["adv", "Pierre", "pierre", 1500, "sacrifie dès l'ouverture"], ["adv", "Joel", "joel", 1600, "patient"],
    ["adv", "Isabel", "isabel", 1600, "précise"], ["adv", "Wally", "wally", 1800, "redoutable en finale"], ["adv", "Li", "li", 2000, "attaquant"], ["adv", "Wilson", "wilson", 2100, "presque maître"],
    ["mai", "Noam", "noam", 2200, "théoricien"], ["mai", "Nora", "nora", 2200, "dynamique"], ["mai", "Hans", "hans", 2250, "attaque à outrance"], ["mai", "Ahmed", "ahmed", 2300, "positionnel"],
    ["mai", "Sakura", "sakura", 2300, "calcul tranchant"], ["mai", "Arjun", "arjun", 2350, "jeune prodige"], ["mai", "Francis", "francis", 2350, "joueur de club redoutable"],
    ["mai", "Sofia", "sofia", 2400, "maître international"], ["mai", "Alexander", "alexander", 2400, "défense de fer"], ["mai", "Luke", "luke", 2450, "finales techniques"], ["mai", "Wei", "wei", 2450, "universel"],
    ["pro", "Magnus Carlsen", "magnus_carlsen", 2882, "profil inspiré · universel", "magnus"], ["pro", "Hikaru Nakamura", "hikaru_nakamura", 2830, "profil inspiré · rapide", "hikaru"],
    ["pro", "Fabiano Caruana", "fabiano_caruana", 2803, "profil inspiré · préparation"], ["pro", "Ding Liren", "ding_liren", 2762, "profil inspiré · solide"],
    ["pro", "Viswanathan Anand", "viswanathan_anand", 2754, "profil inspiré · le Tigre de Madras"], ["pro", "Anna Muzychuk", "anna_muzychuk", 2550, "profil inspiré · GM"],
    ["pro", "Alexandra Kosteniuk", "alexandra_kosteniuk", 2500, "profil inspiré · GM"], ["pro", "Daniel Naroditsky", "daniel_naroditsky", 2650, "profil inspiré · le professeur du speedrun"],
    ["pro", "Levy Rozman", "levy_rozman", 2500, "profil inspiré · GothamChess", "levy"],
    ["pro", "Wesley So", "wesley_so", 2770, "profil inspiré · technique"], ["pro", "Anish Giri", "anish_giri", 2764, "profil inspiré · préparation"],
    ["pro", "Alireza Firouzja", "alireza_firouzja", 2760, "profil inspiré · agressif"], ["pro", "Ian Nepomniachtchi", "ian_nepomniachtchi", 2758, "profil inspiré · rapide et tranchant"],
    ["pro", "Sergey Karjakin", "sergey_karjakin", 2757, "profil inspiré · défenseur"], ["pro", "Levon Aronian", "levon_aronian", 2755, "profil inspiré · créatif"],
    ["pro", "Maxime Vachier-Lagrave", "maxime_vachier_lagrave", 2752, "profil inspiré · Najdorf et Grünfeld"], ["pro", "Teimour Radjabov", "teimour_radjabov", 2747, "profil inspiré · solide"],
    ["pro", "Shakhriyar Mamedyarov", "shakhriyar_mamedyarov", 2746, "profil inspiré · attaquant"], ["pro", "Richard Rapport", "richard_rapport", 2743, "profil inspiré · ouvertures originales"],
    ["pro", "Judit Polgár", "judit_polgar", 2735, "profil inspiré · attaquante légendaire"], ["pro", "Hou Yifan", "hou_yifan", 2658, "profil inspiré · championne du monde"],
    ["pro", "Nana Dzagnidze", "nana_dzagnidze", 2541, "profil inspiré · GM"], ["pro", "Sophie Milliet", "sophie_milliet", 2400, "profil inspiré · MI"], ["pro", "Irina Krush", "irina_krush", 2388, "profil inspiré · GM"],
    ["cel", "Alexandra Botez", "alexandra_botez", 2200, "profil inspiré · streameuse"], ["cel", "Robert Hess", "robert_hess", 2600, "profil inspiré · GM commentateur"],
    ["cel", "Danny Rensch", "danny_rensch", 2400, "profil inspiré · IM"], ["cel", "MrBeast", "mrbeast", 600, "profil inspiré · défi fun"], ["cel", "boxbox", "boxbox", 1500, "profil inspiré · streamer"],
    ["cel", "Andrea Botez", "andrea_botez", 2000, "profil inspiré · streameuse"], ["cel", "Anna Cramling", "anna_cramling", 2200, "profil inspiré · streameuse"],
    ["cel", "Beth Harmon", "beth_harmon", 2600, "personnage de fiction · Le Jeu de la dame"],
    ["spe", "Mittens", "mittens", 1, "« 1 Elo »… joue à 3200", { real: 3200 }], ["spe", "Scaredy Cat", "scaredy_cat", 1200, "fuit au moindre échec"], ["spe", "Angry Cat", "angry_cat", 1800, "attaque tout"],
    ["spe", "Cool Cat", "cool_cat", 2000, "trop cool pour paniquer"], ["spe", "Sassy Cat", "sassy_cat", 2100, "insolente et précise"],
    ["spe", "Mr. Grumpers", "mr_grumpers", 1700, "grognon mais solide"], ["spe", "Catspurrov", "catspurrov", 2400, "le chat champion"], ["spe", "Deadlost", "deadlost", 1800, "revenant d'Halloween"],
    ["spe", "Grandpa Gambit", "grandpa_gambit", 1700, "que des gambits"], ["spe", "FrankenIsla", "frankenisla", 1500, "monstre de fêtes"], ["spe", "ChessGPT", "chessgpt", 3000, "IA d'échecs (rien à voir avec ChatGPT Prime)"],
    ["spe", "Chippy", "chippy", 1800, "petit robot"], ["spe", "PAL 9000", "pal_9000", 2500, "IA spatiale implacable"], ["spe", "Skyweb", "skyweb", 2400, "IA qui voit tout"],
    ["spe", "Agent Chess", "agent_chess", 2350, "espion"], ["spe", "Le Turc mécanique", "le_turc_mecanique", 1800, "automate de 1770", "turk"],
    ["ada", "Nisha", "nisha", 0, "s'adapte à ton niveau", { adapt: true }], ["ada", "Tomas", "tomas", 0, "s'adapte à ton niveau", { adapt: true }],
    ["ada", "Devon", "devon", 0, "s'adapte à ton niveau", { adapt: true }], ["ada", "Natasha", "natasha", 0, "s'adapte à ton niveau", { adapt: true }],
    ["coa", "Isaac", "isaac", 1500, "coach : explique ses plans"], ["coa", "Coach", "coach", 1800, "coach : solide et pédagogue"], ["coa", "Dr. Wolf", "dr_wolf", 2000, "coach : exigeant"],
    ["ody", "Cyclops", "cyclops", 1000, "un seul œil, une seule idée"], ["ody", "Siren", "siren", 1400, "pièges envoûtants"], ["ody", "Poseidon", "poseidon", 1800, "tempête sur le plateau"],
    ["ody", "Circe", "circe", 2200, "transforme tes pièces en cochons"], ["ody", "Odysseus", "odysseus", 2600, "rusé, le héros de l'Odyssée"],
  ];
  // livres d'ouvertures par niveau (le bot en prend 2 Blancs + 2 Noirs, tirés de son nom)
  const BOOK = {
    deb: { w: ["e4 e5 Qh5 Nc6 Bc4 Nf6", "e4 e5 Bc4 Nc6 Qf3 Nf6", "a4 e5 h4 d5 Ra3", "e4 e5 Qf3 Nc6 Bc4 Nf6", "d4 d5 Bf4 Nf6 e3 e6 Nf3"], b: ["e4 e5 Nf3 f6", "e4 e5 Nf3 Qe7", "d4 d5 c4 f6", "e4 Nc6 d4 e5", "d4 e5 dxe5 Nc6"] },
    int: { w: ["e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3", "d4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2", "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6"], b: ["e4 d5 exd5 Qxd5 Nc3 Qa5", "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5", "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7"] },
    adv: { w: ["e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7", "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"], b: ["e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O", "e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7"] },
    mai: { w: ["e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O", "d4 Nf6 c4 e6 Nf3 d5 Nc3 Be7 Bf4 O-O e3 c5", "Nf3 d5 g3 Nf6 Bg2 c6 O-O Bg4 d3"], b: ["e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6", "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6", "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5"] },
  };
  const tierOf = (e) => (e < 1000 ? "deb" : e < 1500 ? "int" : e < 2200 ? "adv" : "mai");
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  /** force d'après l'Elo : coups AU HASARD sous 900, gaffes (≥ 2,5 pions) et erreurs (1 à 2,5 pions) de plus en plus rares en montant */
  const skillOf = (e) => ({ random: e <= 1 ? 1 : e < 900 ? +(0.75 * (900 - e) / 900).toFixed(3) : 0, blunder: e >= 2600 ? 0 : +Math.min(0.3, 0.3 * Math.pow((2600 - e) / 2600, 1.6)).toFixed(3),
    mistake: +Math.max(0.004, 0.32 * Math.pow(Math.max(0, 2900 - e) / 2900, 1.3)).toFixed(3), acpl: Math.round(Math.max(4, 160 * Math.pow(Math.max(0, 2900 - e) / 2900, 1.5))) });
  const toUci = (m) => m.from + m.to + (m.promotion || "");
  function book(lines, color) {
    const tree = {}; if (typeof Chess !== "function") return tree;
    lines.forEach((san) => { const ch = new Chess(); const path = []; for (const s of san.split(" ")) { const m = ch.move(s, { sloppy: true }); if (!m) break; if (m.color === color) { const k = path.join(" "), node = (tree[k] = tree[k] || {}); node[toUci(m)] = (node[toUci(m)] || 0) + 1; } path.push(toUci(m)); } });
    return tree;
  }
  const LINES = (who) => ({ greet: [who ? `Profil « ${who} » prêt. Bonne partie, {me} !` : "Bonne partie, {me} !", "On joue ?"], good: ["Bon coup.", "Je continue mon plan."], check: ["Échec !"], bot_brilliant: ["Ça, c'était fort !"], bot_blunder: ["Oups…"], bot_mistake: ["Pas terrible."], h_brilliant: ["Magnifique, {me} !"], h_blunder: ["Merci du cadeau !"] });
  const adaptElo = () => { try { return Math.max(100, Math.min(3000, +(E.settings && E.settings.get("roster.adapt", 1200)) || 1200)); } catch (e) { return 1200; } };
  const list = R.map(([cat, name, file, elo, sub, x]) => {
    const link = typeof x === "string" ? x : "", o = x && typeof x === "object" ? x : {}, id = link || "r_" + file;
    return { id, cat, name, img: "img/roster/" + file + ".png", elo, sub, link, adapt: !!o.adapt, real: o.real || null, person: cat === "pro" || (cat === "cel" && file !== "beth_harmon") };
  });
  list.forEach((b) => {
    if (b.link) { const d = E.aiBots && E.aiBots.def[b.link]; if (d) d.img = b.img; if (E.botChat && E.botChat.bots && E.botChat.bots[b.link]) E.botChat.bots[b.link].img = b.img; return; }     // Magnus, Hikaru, Levy, le Turc : profils existants, nouvel avatar
    const strength = b.real || b.elo || 1200, t = tierOf(strength), h = hash(b.name), pick = (arr, k) => [arr[(h + k) % arr.length], arr[(h + k * 7 + 1) % arr.length]];
    let bk = null; const W = pick(BOOK[t].w, 0), Bl = pick(BOOK[t].b, 3);
    AIP[b.id] = { name: b.name, eloEst: b.elo, roster: true, skill: skillOf(strength), capRate: 0.2 + ((h >> 3) % 20) / 100, checkRate: 0.1 + ((h >> 7) % 20) / 100, games: 0, tag: b.sub,
      get book() { return (bk = bk || { w: book(W, "w"), b: book(Bl, "b") }); } };
    if (E.botChat && E.botChat.bots) E.botChat.bots[b.id] = { name: b.name, img: b.img, style: `Tu es ${b.name}, un personnage qui joue aux échecs (${b.sub}). Phrases courtes, en français.` };
    window.ENOS_BOT_LINES = window.ENOS_BOT_LINES || {}; window.ENOS_BOT_LINES[b.id] = LINES(b.person ? b.name : "");
  });
  E.botRoster = { CATS, list, byId: Object.fromEntries(list.map((b) => [b.id, b])), skillOf, adaptElo,
    /** fin de partie contre un bot adaptatif : il suit ton niveau */
    adapted(won, lost) { if (!E.settings) return; const v = adaptElo() + (won ? 100 : lost ? -100 : 0); E.settings.set("roster.adapt", Math.max(100, Math.min(3000, v))); } };
})();
