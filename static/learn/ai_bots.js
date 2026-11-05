"use strict";
// BOTS « IA » (Défis) : Claude Fable 5, ChatGPT 6 Astra, Gemini 4 Argon, DeepSeek V4.1.
// C'est une ILLUSION assumée : aucun appel à ces IA (zéro token). Chaque bot = un profil de style (ouvertures préférées, prudence / agressivité, fréquence d'erreurs) donné à Stockfish, qui joue à leur place.
// Niveaux : calés sur les classements publics de parties LLM (ChessBench, oct. 2026 : Gemini 4 Argon 2168 · Claude Opus 5.5 2111 · GPT-6 Astra 2043 · DeepSeek V4.1 1692) ; ce ne sont PAS des Elo FIDE (échelle de benchmark, adversaires logiciels).
// Les ouvertures / styles sont des ESTIMATIONS (aucune source publique ne détaille les ouvertures favorites de chaque modèle : constat général = théorie classique solide au début, erreurs en milieu de partie / quand la position sort du livre).
(() => {
  const E = window.ENOS, P = (window.ENOS_AIPROF = {});
  // lignes : [poids, "coups SAN"] — on enregistre les coups du camp concerné
  const DEF = {
    claude: {
      name: "Claude Fable 5", short: "Claude", elo: 2150, tag: "prudent · positionnel · pédagogue", img: "img/bots/claude.png",
      skill: { mistake: 0.07, blunder: 0.01, acpl: 28 }, capRate: 0.16, checkRate: 0.08,
      w: [[6, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O"], [3, "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O"], [4, "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3"]],
      b: [[6, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6"], [3, "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6"], [4, "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O"], [3, "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5"]],
      lines: { greet: ["Bonjour {me}. Une belle partie, sans précipitation ?", "On joue ? Je vais prendre le temps de bien réfléchir à chaque coup."], good: ["Un coup solide, je développe tranquillement.", "Position équilibrée pour l'instant."], check: ["Échec — avec prudence."], bot_brilliant: ["Hm, ce sacrifice est plus audacieux que mon style habituel."], bot_blunder: ["Je me suis trompé là. Je reconnais l'erreur."], bot_mistake: ["Pas mon meilleur coup, je l'admets."], h_brilliant: ["Magnifique, {me}. Je ne l'avais pas vu venir."], h_blunder: ["Je ne voudrais pas abuser, mais ce coup affaiblit ta position."], mate_win: ["Échec et mat. Merci pour cette belle partie !"], mate_lose: ["Bien joué {me}, je m'incline avec plaisir."], draw: ["Nulle, un résultat honnête."], open_announce: ["Je connais bien cette ouverture : {open}."] },
    },
    gpt: {
      name: "ChatGPT 6 Astra", short: "GPT-6 Astra", elo: 2045, tag: "théorique · direct · sûr de lui", img: "img/bots/gpt.png",
      skill: { mistake: 0.14, blunder: 0.03, acpl: 41 }, capRate: 0.27, checkRate: 0.2,
      w: [[5, "e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 c3 d6 O-O"], [3, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7"], [3, "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O"], [1, "Nf3 d5 g3 Nf6 Bg2 e6 O-O"]],
      b: [[3, "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5 c6"], [4, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7"], [3, "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5"], [2, "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"]],
      lines: { greet: ["Salut {me} ! Voici un plan en 3 étapes : développer, roquer, gagner. 😄", "Excellente idée de jouer ! Je commence par un coup de théorie."], good: ["Coup de manuel, rien à redire.", "Voilà exactement ce que recommande la théorie."], check: ["Échec ! Ça, c'est de l'initiative."], bot_brilliant: ["Un sacrifice stratégique : je l'avais calculé, bien sûr."], bot_blunder: ["Ah. Une approche… inhabituelle. Disons que c'était volontaire."], bot_mistake: ["Petite imprécision, rien de grave !"], h_brilliant: ["Impressionnant ! Je note ce coup pour la suite."], h_blunder: ["Sauf erreur de ma part, ce coup perd du matériel 😉"], mate_win: ["Mat ! Résumé : une partie bien menée."], mate_lose: ["Bravo {me}, je mets ça sur le compte de la variance."], draw: ["Nulle : un résultat équilibré, on est d'accord."], open_announce: ["Ah, {open} ! Un grand classique."] },
    },
    gemini: {
      name: "Gemini 4 Argon", short: "Gemini 4 Argon", elo: 2170, tag: "dynamique · tactique · Sicilienne", img: "img/bots/gemini.png",
      skill: { mistake: 0.09, blunder: 0.015, acpl: 31 }, capRate: 0.26, checkRate: 0.2,
      w: [[6, "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5"], [3, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O"], [3, "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O"]],
      b: [[7, "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5"], [3, "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O"], [2, "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4"], [2, "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4"]],
      lines: { greet: ["Prêt pour une partie tranchante, {me} ? Je vois déjà plusieurs pistes tactiques ✨", "Allez, on met le plateau en feu !"], good: ["Ça complique les choses, comme je les aime.", "Initiative conservée."], check: ["Échec ! L'attaque est lancée."], bot_brilliant: ["Boom : sacrifice calculé jusqu'au bout ✨"], bot_blunder: ["Aïe, mon calcul s'est arrêté trop tôt."], bot_mistake: ["Imprécision : je recalcule."], h_brilliant: ["Waouh, là c'est du très haut niveau {me} !"], h_blunder: ["Tu me laisses une tactique ici…"], mate_win: ["Mat ! La combinaison était là depuis plusieurs coups."], mate_lose: ["Bien vu {me} ! Je n'avais pas calculé ce mat."], draw: ["Nulle après une belle bataille."], open_announce: ["{open} : mon terrain de jeu préféré."] },
    },
    deepseek: {
      name: "DeepSeek V4.1", short: "DeepSeek", elo: 1690, tag: "imprévisible · gourmand · sorties de dame", img: "img/bots/deepseek.png",
      skill: { mistake: 0.22, blunder: 0.08, acpl: 78 }, capRate: 0.34, checkRate: 0.26,
      w: [[5, "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6"], [2, "e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#"], [3, "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6"], [2, "d4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6"]],
      b: [[4, "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6"], [3, "e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5"], [3, "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7"], [1, "e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6"]],
      lines: { greet: ["Salut {me}. Je réfléchis longuement… puis je joue vite ! 🐋", "On joue. Je promets de ne pas sortir ma dame trop tôt (peut-être)."], good: ["Mon plan : prendre tout ce qui dépasse.", "Je capture, c'est gratuit !"], check: ["Échec ! (je crois que c'est légal)"], bot_brilliant: ["Un coup brillant ? C'était complètement intentionnel."], bot_blunder: ["Hmm… ma dame était vraiment en prise ? 🐋"], bot_mistake: ["Erreur de calcul, ça arrive."], h_brilliant: ["Ah, tu m'as eu {me}. Bien joué."], h_blunder: ["Merci pour la pièce !"], mate_win: ["Mat ! Je n'y croyais pas moi-même."], mate_lose: ["Bien joué {me}, j'avais mal évalué la position."], draw: ["Nulle ? Je pensais gagner, mais soit."], open_announce: ["{open} ? Je connais, je crois."] },
    },
  };
  const toUci = (m) => m.from + m.to + (m.promotion || "");
  function book(lines, color) {                                                                  // arbre {chemin uci : {coup uci : poids}} des seuls coups du camp `color`
    const tree = {};
    (lines || []).forEach(([w, san]) => {
      const ch = new Chess(); let path = [];
      for (const s of san.split(" ")) {
        const m = ch.move(s, { sloppy: true }); if (!m) break;
        if (m.color === color) { const k = path.join(" "), node = (tree[k] = tree[k] || {}); node[toUci(m)] = (node[toUci(m)] || 0) + w; }
        path.push(toUci(m));
      }
    });
    return tree;
  }
  E.aiBots = { ids: Object.keys(DEF), def: DEF, prof: P };
  Object.entries(DEF).forEach(([id, d]) => {
    P[id] = { name: d.name, eloEst: d.elo, skill: d.skill, capRate: d.capRate, checkRate: d.checkRate, games: 0, ai: true, tag: d.tag, book: { w: book(d.w, "w"), b: book(d.b, "b") } };
    if (E.botChat && E.botChat.bots) E.botChat.bots[id] = { name: d.name, img: d.img, style: `Tu es ${d.name}, un assistant IA qui joue aux échecs (${d.tag}). Phrases courtes, en français.` };
    window.ENOS_BOT_LINES = window.ENOS_BOT_LINES || {}; window.ENOS_BOT_LINES[id] = d.lines;
  });
})();
