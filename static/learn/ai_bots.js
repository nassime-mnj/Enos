"use strict";
// BOTS « IA » (Défis) : Claude Fable 5, ChatGPT 6 Astra, Gemini 4 Argon, DeepSeek V4.1 ; MOTEURS (`engine: true`) : Leela Chess Zero, Maia 1100/1500/1900, Ethereal, Berserk, Koivisto (profils de style) + Obsidian, PlentyChess, Caissa, Viridithas (VRAIS moteurs natifs sur le téléphone, `native`).
// Les vrais moteurs (Lc0, Maia, Ethereal, Berserk, Koivisto) ne sont PAS embarqués (binaires UCI : pas dans le téléphone) : Stockfish.js joue à leur place avec leur style (ouvertures, agressivité, taux d'erreurs).
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
    lc0: {
      name: "Leela Chess Zero (Lc0)", short: "Lc0", elo: 3300, tag: "réseau de neurones · positionnel · patient", img: "img/bots/lc0.png", engine: true,
      skill: { mistake: 0.004, blunder: 0, acpl: 6 }, capRate: 0.16, checkRate: 0.09,
      w: [[4, "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5"], [3, "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5"], [3, "c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6"], [1, "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7"]],
      b: [[4, "e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Nc6"], [3, "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5"], [3, "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7 Be3 a6"], [2, "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7"]],
      lines: { greet: ["Salut {me}. Je calcule en silence… allons-y.", "Réseau chargé. On joue ?"], good: ["La structure de pions compte plus que le matériel.", "Je préfère l'espace à la prise immédiate."], check: ["Échec, avec patience."], bot_brilliant: ["Un sacrifice positionnel : le plan tient sur le long terme."], bot_blunder: ["Mon évaluation était erronée là. Rare."], bot_mistake: ["Pas optimal, je l'accorde."], h_brilliant: ["Joli : mon réseau ne l'avait pas prévu."], h_blunder: ["Ce coup cède trop de cases. Mes poids le disent."], mate_win: ["Échec et mat. Bonne partie, {me}."], mate_lose: ["Bien joué {me}. Je m'incline."], draw: ["Nulle : position d'équilibre."], open_announce: ["Ouverture : {open}."] },
    },
    maia1100: {
      name: "Maia 1100", short: "Maia 1100", elo: 1100, tag: "humain · entraîné sur des parties réelles · erreurs réalistes", img: "img/bots/maia.png", engine: true,
      skill: { mistake: 0.3, blunder: 0.12, acpl: 120 }, capRate: 0.3, checkRate: 0.22,
      w: [[5, "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O"], [3, "d4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6"], [3, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7"], [2, "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O"]],
      b: [[4, "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6"], [3, "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"], [3, "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O"], [2, "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6"]],
      lines: { greet: ["Salut {me} ! Je joue comme un humain de 1100 Elo : parfois je me trompe, c'est voulu.", "Une partie ? Je ne promets pas de ne pas gaffer."], good: ["Un coup de joueur de club.", "Je développe, comme on me l'a appris."], check: ["Échec !"], bot_brilliant: ["Oh, un coup brillant… j'ai de la chance."], bot_blunder: ["Oups… j'ai gaffé, comme un humain."], bot_mistake: ["Hmm, pas terrible."], h_brilliant: ["Bien vu {me} !"], h_blunder: ["Attention, ce coup perd quelque chose."], mate_win: ["Échec et mat ! Pour une fois ça marche."], mate_lose: ["Bravo {me}, tu m'as battu."], draw: ["Nulle, j'accepte."], open_announce: ["Ouverture : {open}."] },
    },
    maia1500: {
      name: "Maia 1500", short: "Maia 1500", elo: 1500, tag: "humain · entraîné sur des parties réelles · erreurs réalistes", img: "img/bots/maia.png", engine: true,
      skill: { mistake: 0.2, blunder: 0.06, acpl: 80 }, capRate: 0.3, checkRate: 0.22,
      w: [[5, "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O"], [3, "d4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6"], [3, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7"], [2, "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O"]],
      b: [[4, "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6"], [3, "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"], [3, "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O"], [2, "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6"]],
      lines: { greet: ["Salut {me} ! Je joue comme un humain de 1500 Elo : parfois je me trompe, c'est voulu.", "Une partie ? Je ne promets pas de ne pas gaffer."], good: ["Un coup de joueur de club.", "Je développe, comme on me l'a appris."], check: ["Échec !"], bot_brilliant: ["Oh, un coup brillant… j'ai de la chance."], bot_blunder: ["Oups… j'ai gaffé, comme un humain."], bot_mistake: ["Hmm, pas terrible."], h_brilliant: ["Bien vu {me} !"], h_blunder: ["Attention, ce coup perd quelque chose."], mate_win: ["Échec et mat ! Pour une fois ça marche."], mate_lose: ["Bravo {me}, tu m'as battu."], draw: ["Nulle, j'accepte."], open_announce: ["Ouverture : {open}."] },
    },
    maia1900: {
      name: "Maia 1900", short: "Maia 1900", elo: 1900, tag: "humain · entraîné sur des parties réelles · erreurs réalistes", img: "img/bots/maia.png", engine: true,
      skill: { mistake: 0.12, blunder: 0.03, acpl: 50 }, capRate: 0.3, checkRate: 0.22,
      w: [[5, "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O"], [3, "d4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6"], [3, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7"], [2, "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O"]],
      b: [[4, "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6"], [3, "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"], [3, "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O"], [2, "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6"]],
      lines: { greet: ["Salut {me} ! Je joue comme un humain de 1900 Elo : parfois je me trompe, c'est voulu.", "Une partie ? Je ne promets pas de ne pas gaffer."], good: ["Un coup de joueur de club.", "Je développe, comme on me l'a appris."], check: ["Échec !"], bot_brilliant: ["Oh, un coup brillant… j'ai de la chance."], bot_blunder: ["Oups… j'ai gaffé, comme un humain."], bot_mistake: ["Hmm, pas terrible."], h_brilliant: ["Bien vu {me} !"], h_blunder: ["Attention, ce coup perd quelque chose."], mate_win: ["Échec et mat ! Pour une fois ça marche."], mate_lose: ["Bravo {me}, tu m'as battu."], draw: ["Nulle, j'accepte."], open_announce: ["Ouverture : {open}."] },
    },
    ethereal: {
      name: "Ethereal", short: "Ethereal", elo: 3350, tag: "alpha-bêta + NNUE · propre · précis", img: "img/bots/ethereal.png", engine: true,
      skill: { mistake: 0.003, blunder: 0, acpl: 5 }, capRate: 0.2, checkRate: 0.12,
      w: [[4, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O"], [3, "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5"], [2, "Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3"]],
      b: [[4, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6"], [3, "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5"], [3, "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be2 e5"]],
      lines: { greet: ["Bonjour {me}. Code propre, coups propres.", "On commence ?"], good: ["Un coup net, sans fioritures.", "Position sous contrôle."], check: ["Échec."], bot_brilliant: ["Combinaison propre : tout se tient."], bot_blunder: ["Un bug dans mon évaluation… corrigé."], bot_mistake: ["Imprécision enregistrée."], h_brilliant: ["Coup de grande classe, {me}."], h_blunder: ["Erreur tactique détectée."], mate_win: ["Échec et mat."], mate_lose: ["Bien joué {me}. Mes compliments."], draw: ["Nulle par équilibre."], open_announce: ["Ouverture : {open}."] },
    },
    berserk: {
      name: "Berserk", short: "Berserk", elo: 3400, tag: "alpha-bêta + NNUE · tactique · très agressif", img: "img/bots/berserk.png", engine: true,
      skill: { mistake: 0.004, blunder: 0, acpl: 6 }, capRate: 0.4, checkRate: 0.32,
      w: [[5, "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5 e6 f4"], [3, "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5"], [2, "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3"]],
      b: [[5, "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5 e6 f4"], [3, "e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 Nc3"], [2, "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3 O-O"]],
      lines: { greet: ["BERSERK. Prépare-toi, {me}.", "Je ne fais pas de prisonniers."], good: ["À l'attaque !", "Je prends l'initiative, toujours."], check: ["ÉCHEC ! Plus vite !"], bot_brilliant: ["Sacrifice ! Que la tactique parle !"], bot_blunder: ["Je me suis emballé…"], bot_mistake: ["Trop pressé."], h_brilliant: ["Beau, {me}… mais je continue."], h_blunder: ["Tu laisses trop de pièces en prise !"], mate_win: ["ÉCHEC ET MAT !"], mate_lose: ["Bien joué {me}. La revanche !"], draw: ["Nulle ? Pas mon genre."], open_announce: ["Ouverture : {open}."] },
    },
    koivisto: {
      name: "Koivisto", short: "Koivisto", elo: 3350, tag: "alpha-bêta + NNUE · collaboratif · dynamique", img: "img/bots/koivisto.png", engine: true,
      skill: { mistake: 0.004, blunder: 0, acpl: 6 }, capRate: 0.3, checkRate: 0.2,
      w: [[3, "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nc3 Bb4"], [4, "d4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3 Qxc3 b6"], [3, "e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6 Bd3 Nf6 O-O Qc7"]],
      b: [[4, "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5"], [3, "d4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3 Qxc3 b6"], [3, "e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6 Bd3 Nf6 O-O Qc7"]],
      lines: { greet: ["Salut {me} ! Moteur d'équipe, partie d'équipe.", "C'est parti, un coup après l'autre."], good: ["Bon développement.", "Je garde la tension."], check: ["Échec !"], bot_brilliant: ["Un coup brillant, toute l'équipe applaudit."], bot_blunder: ["Une erreur de notre part… on corrige."], bot_mistake: ["Pas idéal."], h_brilliant: ["Beau coup {me} !"], h_blunder: ["Attention à ce coup, il coûte cher."], mate_win: ["Échec et mat !"], mate_lose: ["Bien joué {me}, bravo."], draw: ["Nulle, belle bataille."], open_announce: ["Ouverture : {open}."] },
    },
    // VRAIS MOTEURS embarqués (binaires ARM64 natifs, android/tools/build_engines.sh) : sur le téléphone c'est LE moteur qui joue (`native`) ;
    // ailleurs (navigateur, PC) Stockfish joue à sa place avec le profil ci-dessous. Elo = ordre de grandeur des listes de moteurs (CCRL), approximatif.
    obsidian: {
      name: "Obsidian", short: "Obsidian", elo: 3650, tag: "moteur NNUE · cristal violet · calcul tranchant", img: "img/bots/obsidian.png", engine: true, native: "obsidian",
      skill: { mistake: 0.002, blunder: 0, acpl: 4 }, capRate: 0.3, checkRate: 0.2,
      w: [[4, "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6"], [4, "d4 Nf6 c4 e6 Nf3 d5 Nc3 Be7 Bf4 O-O e3 c5"]],
      b: [[4, "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5"], [4, "d4 Nf6 c4 e6 Nf3 d5 Nc3 Be7 Bf4 O-O e3 c5"]],
      lines: { greet: ["Obsidian. Que le calcul commence.", "Prêt, {me}."], good: ["Ligne calculée.", "Rien n'échappe au cristal."], check: ["Échec."], bot_brilliant: ["Le sacrifice était dans les calculs."], bot_blunder: ["Une fissure dans le cristal…"], bot_mistake: ["Imprécis."], h_brilliant: ["Très fort, {me}."], h_blunder: ["Je le vois."] },
    },
    plenty: {
      name: "PlentyChess", short: "PlentyChess", elo: 3640, tag: "moteur NNUE · turquoise et or · jeu riche", img: "img/bots/plenty.png", engine: true, native: "plenty",
      skill: { mistake: 0.002, blunder: 0, acpl: 4 }, capRate: 0.28, checkRate: 0.18,
      w: [[4, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O"], [4, "d4 d5 c4 c6 Nf3 Nf6 Nc3 a6 e3 b5"]],
      b: [[4, "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"], [4, "d4 d5 c4 c6 Nf3 Nf6 Nc3 a6 e3 b5"]],
      lines: { greet: ["PlentyChess : il y a de la place pour tout le monde… sauf pour tes erreurs.", "On joue, {me} ?"], good: ["Plein d'idées.", "Position riche."], check: ["Échec !"], bot_brilliant: ["Un coup en or."], bot_blunder: ["Trop de choix, mauvais choix."], bot_mistake: ["Pas idéal."], h_brilliant: ["Joli, {me}."], h_blunder: ["Merci."] },
    },
    caissa: {
      name: "Caissa", short: "Caissa", elo: 3560, tag: "moteur NNUE · la déesse des échecs · harmonieux", img: "img/bots/caissa.png", engine: true, native: "caissa",
      skill: { mistake: 0.003, blunder: 0, acpl: 5 }, capRate: 0.22, checkRate: 0.14,
      w: [[4, "d4 Nf6 c4 e6 Nf3 d5 g3 Be7 Bg2 O-O O-O dxc4"], [3, "Nf3 d5 g3 Nf6 Bg2 c6 O-O Bg4"]],
      b: [[4, "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6"], [3, "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6"]],
      lines: { greet: ["Caissa, déesse des échecs, te salue, {me}.", "Que la partie soit belle."], good: ["L'harmonie avant tout.", "Chaque pièce à sa place."], check: ["Échec, mortel."], bot_brilliant: ["Un coup digne de l'Olympe."], bot_blunder: ["Même une déesse se trompe."], bot_mistake: ["Imparfait."], h_brilliant: ["Tu as la faveur des dieux, {me}."], h_blunder: ["Les dieux sont déçus."] },
    },
    viridithas: {
      name: "Viridithas", short: "Viridithas", elo: 3600, tag: "moteur NNUE · cavalier végétal · étouffe lentement", img: "img/bots/viridithas.png", engine: true, native: "viridithas",
      skill: { mistake: 0.002, blunder: 0, acpl: 4 }, capRate: 0.24, checkRate: 0.15,
      w: [[4, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7"], [4, "d4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3 Qxc3"]],
      b: [[4, "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7"], [4, "d4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3 Qxc3"]],
      lines: { greet: ["Viridithas pousse lentement… comme du lierre.", "On y va, {me}."], good: ["Ça pousse.", "Je prends racine."], check: ["Échec."], bot_brilliant: ["Le lierre a tout recouvert."], bot_blunder: ["Une branche cassée."], bot_mistake: ["Mauvaise herbe."], h_brilliant: ["Belle pousse, {me}."], h_blunder: ["Je prends."] },
    },
    // GRANDS JOUEURS (`player: true`) : PROFILS DE STYLE inspirés de joueurs réels — répertoire d'ouvertures public, force calibrée ; Stockfish joue
    // (aucune citation inventée : répliques neutres ; avatars du pack illustré img/roster, pas de photos). Elo = ordre de grandeur FIDE classique (mi-2026) / estimation historique.
    magnus: {
      name: "Magnus Carlsen", short: "Carlsen", elo: 2882, tag: "profil inspiré · universel · technique de finale", img: "img/roster/magnus_carlsen.png", engine: false, player: true,
      skill: { mistake: 0.01, blunder: 0, acpl: 10 }, capRate: 0.22, checkRate: 0.12,
      w: [[4, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O"], [3, "d4 Nf6 c4 e6 Nf3 d5 Nc3 Be7 Bf4 O-O e3 c5"], [2, "Nf3 d5 g3 Nf6 Bg2 c6 O-O Bg4"]],
      b: [[4, "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6"], [4, "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5"], [3, "d4 Nf6 c4 e6 Nf3 d5 Nc3 Be7 Bf4 O-O"]],
      lines: { greet: ["Profil « Magnus Carlsen » : technique, finales, patience.", "Bonne partie, {me}."], good: ["Petit avantage, on le garde."], check: ["Échec."], bot_brilliant: ["Coup précis."], bot_blunder: ["Imprécision, on corrige."], bot_mistake: ["Pas le plus précis."], h_brilliant: ["Bien vu, {me}."], h_blunder: ["Ça se punit."] },
    },
    hikaru: {
      name: "Hikaru Nakamura", short: "Hikaru", elo: 2830, tag: "profil inspiré · rapide · tactique · initiative", img: "img/roster/hikaru_nakamura.png", engine: false, player: true,
      skill: { mistake: 0.015, blunder: 0.002, acpl: 13 }, capRate: 0.34, checkRate: 0.26,
      w: [[4, "e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 c3 d6 O-O O-O"], [3, "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3"], [2, "d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7"]],
      b: [[4, "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6"], [3, "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"], [4, "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5"]],
      lines: { greet: ["Profil « Hikaru Nakamura » : rapide et tactique.", "Bonne partie, {me}."], good: ["On garde l'initiative."], check: ["Échec."], bot_brilliant: ["Ça part vite !"], bot_blunder: ["Trop rapide sur ce coup."], bot_mistake: ["Pas le plus précis."], h_brilliant: ["Bien vu, {me}."], h_blunder: ["Ça se punit."] },
    },
    levy: {
      name: "Levy Rozman (GothamChess)", short: "GothamChess", elo: 2500, tag: "profil inspiré · Maître International · London et Vienne", img: "img/roster/levy_rozman.png", engine: false, player: true,
      skill: { mistake: 0.06, blunder: 0.008, acpl: 25 }, capRate: 0.3, checkRate: 0.2,
      w: [[5, "d4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3 Nc6 Nbd2 Bd6 Bg3"], [3, "e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3"]],
      b: [[4, "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6"], [3, "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O"]],
      lines: { greet: ["Profil « Levy Rozman / GothamChess » : London et Vienne.", "Bonne partie, {me}."], good: ["Développement classique."], check: ["Échec."], bot_brilliant: ["Joli coup !"], bot_blunder: ["Ce coup était une erreur."], bot_mistake: ["Pas le plus précis."], h_brilliant: ["Bien vu, {me}."], h_blunder: ["Ça se punit."] },
    },
    turk: {
      name: "Le Turc mécanique", short: "Le Turc", elo: 1800, tag: "automate de 1770 · un joueur caché dedans · parties ouvertes", img: "img/roster/le_turc_mecanique.png", engine: false, player: true,
      skill: { mistake: 0.12, blunder: 0.03, acpl: 45 }, capRate: 0.36, checkRate: 0.28,
      w: [[4, "e4 e5 f4 exf4 Nf3 g5 Bc4 g4 O-O"], [3, "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+"]],
      b: [[4, "e4 e5 Qf3 Nc6 Bc4 Nf6 Ne2 Bc5 a3 d6 O-O Bg4"], [3, "d4 d5 c4 dxc4 e3 e5 Bxc4 exd4 exd4"]],
      lines: { greet: ["Le Turc mécanique (1770) : ses engrenages se mettent en marche…", "Bonne partie, {me}."], good: ["Les rouages tournent."], check: ["Échec."], bot_brilliant: ["Mécanique implacable."], bot_blunder: ["Un engrenage a grincé."], bot_mistake: ["Pas le plus précis."], h_brilliant: ["Bien vu, {me}."], h_blunder: ["Ça se punit."] },
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
    let bk = null;                                                                               // livre construit à la demande (chess.js est chargé après ce fichier)
    P[id] = { name: d.name, eloEst: d.elo, native: d.native || "", player: !!d.player, skill: d.skill, capRate: d.capRate, checkRate: d.checkRate, games: 0, ai: true, tag: d.tag, get book() { return (bk = bk || { w: book(d.w, "w"), b: book(d.b, "b") }); } };
    if (E.botChat && E.botChat.bots) E.botChat.bots[id] = { name: d.name, img: d.img, style: `Tu es ${d.name}, un assistant IA qui joue aux échecs (${d.tag}). Phrases courtes, en français.` };
    window.ENOS_BOT_LINES = window.ENOS_BOT_LINES || {}; window.ENOS_BOT_LINES[id] = d.lines;
  });
})();
