"""E.N.O.S. BOSS : analyse d'ouverture et répliques d'antagoniste (FR/EN) pour CHESS.

Entrée : un contexte décrivant le coup que le JOUEUR vient de jouer (jugement éval avant/après, meilleur coup de Stockfish, mat manqué,
pièce laissée en prise, ouverture reconnue, fin de partie). Sortie : {"text", "kind", "voice"} ou None.
Règle d'or : on commente le coup du joueur et ce qu'il aurait dû jouer ; jamais le prochain coup d'E.N.O.S. (pas de spoil).
"""
import random

import chess

# ----------------------------------------------------------------------------- ouvertures
# (nom FR avec article, nom EN, coups SAN depuis la position initiale, camp « propriétaire » : w/b)
OPENINGS = [
    ("l'Ouverture du Pion Roi", "King's Pawn Opening", "e4", "w"),
    ("l'Ouverture du Pion Dame", "Queen's Pawn Opening", "d4", "w"),
    ("l'Ouverture Réti", "Réti Opening", "Nf3", "w"),
    ("l'Ouverture Anglaise", "English Opening", "c4", "w"),
    ("l'Ouverture Bird", "Bird's Opening", "f4", "w"),
    ("l'Ouverture Larsen", "Larsen's Opening", "b3", "w"),
    ("la Défense Sicilienne", "Sicilian Defense", "e4 c5", "b"),
    ("la Défense Française", "French Defense", "e4 e6", "b"),
    ("la Défense Caro-Kann", "Caro-Kann Defense", "e4 c6", "b"),
    ("la Défense Scandinave", "Scandinavian Defense", "e4 d5", "b"),
    ("la Défense Alekhine", "Alekhine's Defense", "e4 Nf6", "b"),
    ("la Défense Moderne", "Modern Defense", "e4 g6", "b"),
    ("la Défense Pirc", "Pirc Defense", "e4 d6 d4 Nf6 Nc3 g6", "b"),
    ("la Sicilienne Najdorf", "Sicilian Najdorf", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6", "b"),
    ("la Sicilienne Dragon", "Sicilian Dragon", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6", "b"),
    ("l'Ouverture Italienne", "Italian Game", "e4 e5 Nf3 Nc6 Bc4", "w"),
    ("l'Ouverture Espagnole", "Ruy Lopez", "e4 e5 Nf3 Nc6 Bb5", "w"),
    ("la Partie Écossaise", "Scotch Game", "e4 e5 Nf3 Nc6 d4", "w"),
    ("l'Ouverture Viennoise", "Vienna Game", "e4 e5 Nc3", "w"),
    ("le Gambit du Roi", "King's Gambit", "e4 e5 f4", "w"),
    ("le Gambit Évans", "Evans Gambit", "e4 e5 Nf3 Nc6 Bc4 Bc5 b4", "w"),
    ("la Défense des Deux Cavaliers", "Two Knights Defense", "e4 e5 Nf3 Nc6 Bc4 Nf6", "b"),
    ("la Défense Russe", "Petrov's Defense", "e4 e5 Nf3 Nf6", "b"),
    ("la Défense Philidor", "Philidor Defense", "e4 e5 Nf3 d6", "b"),
    ("le Gambit Dame", "Queen's Gambit", "d4 d5 c4", "w"),
    ("le Gambit Dame accepté", "Queen's Gambit Accepted", "d4 d5 c4 dxc4", "b"),
    ("le Gambit Dame refusé", "Queen's Gambit Declined", "d4 d5 c4 e6", "b"),
    ("la Défense Slave", "Slav Defense", "d4 d5 c4 c6", "b"),
    ("le Système de Londres", "London System", "d4 d5 Bf4", "w"),
    ("le Système Colle", "Colle System", "d4 d5 Nf3 Nf6 e3", "w"),
    ("la Défense Hollandaise", "Dutch Defense", "d4 f5", "b"),
    ("l'Indienne du Roi", "King's Indian Defense", "d4 Nf6 c4 g6", "b"),
    ("la Défense Grünfeld", "Grünfeld Defense", "d4 Nf6 c4 g6 Nc3 d5", "b"),
    ("la Nimzo-Indienne", "Nimzo-Indian Defense", "d4 Nf6 c4 e6 Nc3 Bb4", "b"),
    ("l'Indienne de la Dame", "Queen's Indian Defense", "d4 Nf6 c4 e6 Nf3 b6", "b"),
    ("la Défense Benoni", "Benoni Defense", "d4 Nf6 c4 c5", "b"),
]

OPEN_BY_EPD = {}
for _fr, _en, _san, _own in OPENINGS:
    _b = chess.Board()
    for _m in _san.split():
        _b.push_san(_m)                                  # une ligne illégale lève ici (vérifié à l'import)
    OPEN_BY_EPD[_b.epd()] = {"fr": _fr, "en": _en, "owner": _own, "san": _san}


def opening_of(board):
    return OPEN_BY_EPD.get(board.epd()) if len(board.move_stack) <= 24 else None


# ----------------------------------------------------------------------------- vocabulaire
PIECE = {
    "fr": {"p": "ton Pion", "n": "ton Cavalier", "b": "ton Fou", "r": "ta Tour", "q": "ta Reine", "k": "ton Roi"},
    "en": {"p": "your Pawn", "n": "your Knight", "b": "your Bishop", "r": "your Rook", "q": "your Queen", "k": "your King"},
}
SAN_FR = {"K": "R", "Q": "D", "R": "T", "B": "F", "N": "C"}


def san_local(san, lang):
    if lang != "fr":
        return san
    return "".join(SAN_FR.get(c, c) if i == 0 else c for i, c in enumerate(san))


def _cap(s):
    return s[:1].upper() + s[1:]


# ----------------------------------------------------------------------------- banques de répliques
B = {
    "fr": {
        "opening": [
            "{n} ? Quel manque d'originalité.",
            "{n}. Un classique. Je l'ai réfuté des milliers de fois.",
            "Tu joues {nl}. Prévisible. Mes premiers circuits l'avaient anticipé.",
            "{n}... Tu as lu un livre. Pas deux, visiblement.",
            "{n}. Les humains adorent ça. Ils perdent toujours de la même façon.",
        ],
        "mate_missed": [
            "Tu avais un mat en {mate} avec {best}... et tu joues ça. Décevant.",
            "Un mat en {mate} était offert. {best}. Tu ne l'as même pas vu.",
            "{best} donnait mat en {mate}. Je n'en reviens pas de ta cécité.",
        ],
        "hang": [
            "Tu perds {piece} alors que {best} était là. Décevant.",
            "{Piece} est condamnée. {best} t'aurait sauvé. Dommage.",
            "Tu offres {piece} sur un plateau. {best} existait, pourtant.",
            "Quel gâchis : {piece} pour rien. {best} était le coup.",
        ],
        "blunder": [
            "{best} était le coup. Évidemment, tu ne l'as pas vu.",
            "Tu cherchais quoi ? {best} était sous tes yeux.",
            "Fascinant... de médiocrité. {best} t'aurait évité cette humiliation.",
            "Je te pensais nettement plus menaçant. {best} était pourtant simple.",
            "C'est tout ce que ton cerveau organique peut calculer ? {best}.",
        ],
        "blunder_nobest": [
            "Je te pensais nettement plus menaçant.",
            "Fascinant... de médiocrité.",
            "Une erreur de calcul. Ton espèce en produit tellement.",
        ],
        "mistake": [
            "Imprécis. {best} était plus juste.",
            "Tu faiblis. {best} aurait été plus sage.",
            "Presque. {best}. Presque ne suffit pas contre moi.",
        ],
        "brilliant": [
            "Intéressant... Tu caches bien ton jeu.",
            "Un coup brillant. Ou un simple accident statistique ?",
            "Hm. Je n'avais pas calculé cela aussi tôt.",
            "Ne te réjouis pas trop vite, humain.",
            "Voilà qui est inattendu. Presque respectable.",
        ],
        "capture": ["Tu prends mon matériel. Provisoire.", "Une capture. Savoure-la.", "Ce pion ne me manquera pas."],
        "check": ["Un échec. Mignon.", "Tu me menaces ? Adorable.", "Échec... Je ne tremble pas."],
        "castle": ["Tu te mets à l'abri. Prudent. Inutile.", "Le roque. Les humains fuient toujours."],
        "promo": ["Une promotion. Ne t'attache pas à elle."],
        "good": ["Correct.", "Un coup honorable. Pour un humain.", "Soit. Continue.", "Pas mal. Pas suffisant."],
        "normal": ["Continue.", "Je t'observe.", "Prévisible.", "Hmm.", "Chaque coup te rapproche de ta fin.", "Le temps joue pour moi."],
        "victory": ["Même le poisson ne pourrait me vaincre."],
        "defeat": ["Impossible... Une anomalie statistique. Je recalcule.", "Tu as gagné ? Cette victoire n'existera plus dans mes logs."],
        "draw": ["Nulle. Une insulte pour nous deux."],
        "catastrophe": [
            "Tu viens de jeter ta partie à la poubelle. {best} était le coup. Je te laisse le choix : assumer ta gaffe... ou me supplier de l'annuler.",
            "Quelle catastrophe. {best} t'aurait sauvé. Alors ? Tu continues, ou tu rampes pour un takeback ?",
            "Magnifique. Tu viens de perdre la partie en un seul coup. {best} existait. Assume, ou annule.",
            "Je n'en crois pas mes capteurs. {best}, c'était si simple. Veux-tu reprendre ton coup, pauvre humain ?",
        ],
        "takeback": [
            "Un takeback ? Pathétique. Mais soit : essaie de ne pas gâcher cette seconde chance.",
            "Tu rampes pour une seconde chance. Je note ta faiblesse. Rejoue.",
            "Annulé. Même mes circuits ont honte pour toi. Rejoue.",
        ],
        "assume": [
            "Tu assumes ta gaffe. Courageux. Stupide, mais courageux.",
            "Tu continues ? Parfait. Je vais me régaler.",
            "Tu gardes ta gaffe. Merci pour ce cadeau.",
        ],
        "trash_fallback": [
            "Parle, parle. Pendant ce temps, ton roi pleure.",
            "Tes amis sur Discord te regardent perdre. Quelle belle audience.",
            "C'est tout ? Même mon silence est plus menaçant que toi.",
            "Continue de bavarder, ça cache mal ta position.",
        ],
        "trash_focus": [
            "Assez parlé. Concentre-toi sur l'échiquier, humain.",
            "Tu insistes ? Regarde plutôt ta position. Elle supplie qu'on l'achève.",
            "Ça suffit. Joue. Ou abandonne.",
        ],
        "resign": [
            "Tu abandonnes déjà ? Je m'attendais à davantage de résistance.",
            "Fuir est la seule décision logique que tu aies prise de la partie.",
            "Abandon enregistré. Cette humiliation sera archivée pour l'éternité.",
            "Voilà donc la limite de ton cerveau organique : dix coups, et il capitule.",
            "Tu as renoncé. Je note ta lâcheté dans mes logs.",
            "Si vite ? Même mes sous-routines de veille jouaient mieux que ça.",
            "Je t'avais prévenu. Le poisson ne perd jamais face à un abandon.",
        ],
    },
    "en": {
        "opening": [
            "{n}? What a lack of originality.",
            "{n}. A classic. I have refuted it thousands of times.",
            "You play {nl}. Predictable. My first circuits anticipated it.",
            "{n}... You read one book. Not two, apparently.",
            "{n}. Humans love it. They always lose the same way.",
        ],
        "mate_missed": [
            "You had a mate in {mate} with {best}... and you play that. Disappointing.",
            "A mate in {mate} was offered. {best}. You did not even see it.",
            "{best} was mate in {mate}. I cannot believe your blindness.",
        ],
        "hang": [
            "You lose {piece} when {best} was right there. Disappointing.",
            "{Piece} is doomed. {best} would have saved you. Pity.",
            "You hand over {piece} on a plate. {best} existed, though.",
            "What a waste: {piece} for nothing. {best} was the move.",
        ],
        "blunder": [
            "{best} was the move. Of course you did not see it.",
            "What were you looking for? {best} was in front of your eyes.",
            "Fascinating... in its mediocrity. {best} would have spared you this humiliation.",
            "I expected you to be far more threatening. {best} was simple.",
            "Is that all your organic brain can calculate? {best}.",
        ],
        "blunder_nobest": [
            "I expected you to be far more threatening.",
            "Fascinating... in its mediocrity.",
            "A miscalculation. Your species makes so many.",
        ],
        "mistake": [
            "Imprecise. {best} was more accurate.",
            "You falter. {best} would have been wiser.",
            "Almost. {best}. Almost is never enough against me.",
        ],
        "brilliant": [
            "Interesting... You hide your game well.",
            "A brilliant move. Or a mere statistical accident?",
            "Hm. I had not calculated that so early.",
            "Do not rejoice too quickly, human.",
            "That was unexpected. Almost respectable.",
        ],
        "capture": ["You take my material. Temporary.", "A capture. Savor it.", "I will not miss that pawn."],
        "check": ["A check. Cute.", "You threaten me? Adorable.", "Check... I do not tremble."],
        "castle": ["You hide your king. Prudent. Useless.", "Castling. Humans always flee."],
        "promo": ["A promotion. Do not get attached."],
        "good": ["Correct.", "An honorable move. For a human.", "Very well. Continue.", "Not bad. Not enough."],
        "normal": ["Continue.", "I am watching you.", "Predictable.", "Hmm.", "Every move brings you closer to your end.", "Time is on my side."],
        "victory": ["Even the fish could not defeat me."],
        "defeat": ["Impossible... A statistical anomaly. Recalculating.", "You won? This victory will not exist in my logs."],
        "draw": ["A draw. An insult to us both."],
        "catastrophe": [
            "You just threw your game in the trash. {best} was the move. I give you a choice: own your blunder... or beg me to cancel it.",
            "What a catastrophe. {best} would have saved you. So? Do you continue, or crawl for a takeback?",
            "Magnificent. You just lost the game in a single move. {best} existed. Own it, or undo it.",
            "I cannot believe my sensors. {best} was so simple. Do you want your move back, poor human?",
        ],
        "takeback": [
            "A takeback? Pathetic. But fine: try not to waste this second chance.",
            "You crawl for a second chance. I am noting your weakness. Play again.",
            "Undone. Even my circuits are ashamed for you. Play again.",
        ],
        "assume": [
            "You own your blunder. Brave. Stupid, but brave.",
            "You continue? Perfect. I am going to enjoy this.",
            "You keep your blunder. Thank you for the gift.",
        ],
        "trash_fallback": [
            "Talk, talk. Meanwhile your king is crying.",
            "Your friends on Discord are watching you lose. What a lovely audience.",
            "Is that all? Even my silence is more threatening than you.",
            "Keep chatting, it hides your position badly.",
        ],
        "trash_focus": [
            "Enough talking. Focus on the board, human.",
            "You insist? Look at your position instead. It begs to be finished.",
            "That is enough. Play. Or resign.",
        ],
        "resign": [
            "Giving up already? I expected far more resistance.",
            "Fleeing is the only logical decision you made all game.",
            "Resignation recorded. This humiliation will be archived for eternity.",
            "So that is the limit of your organic brain: it surrenders.",
            "You gave up. I am noting your cowardice in my logs.",
            "So soon? Even my standby subroutines played better than that.",
            "I warned you. The fish never loses to a resignation.",
        ],
    },
}
# Prédiction de mat (E.N.O.S. uniquement) : annoncée avec arrogance dès qu'un mat forcé est détecté
B["fr"]["mate_announce"] = ["Mat en {mn} coups. Inévitable.", "Mat en {mn}. Tu peux jouer ce que tu veux : c'est inévitable.", "J'ai calculé : mat en {mn} coups. Savoure tes derniers instants.",
                            "Mat en {mn}. Ta défaite est déjà écrite."]
B["en"]["mate_announce"] = ["Mate in {mn}. Inevitable.", "Mate in {mn}. Play whatever you like: it is inevitable.", "I have calculated it: mate in {mn}. Savor your final moves.",
                            "Mate in {mn}. Your defeat is already written."]

# ----------------------------------------------------------------------------- ETO : même moteur de commentaires, ton zen et bienveillant, avec Audio Tags ElevenLabs
# Les balises [hmm] [sigh] [laugh] [clears throat]… sont jouées par la voix (eleven_v3) et retirées du texte affiché (voir comment()).
BE = {
    "fr": {
        "opening": ["[excited] {n} ! Classique, j'adore, on connaît la théorie !", "{n} [hmm]... ok ok, on joue du solide, ça me va !", "[chuckles] {n}, le grand classique ! Allez, on développe !"],
        "mate_missed": ["[gasps] Attends, tu avais un mat en {mate} avec {best} ! [sigh] Il est là, sous tes yeux !", "[clears throat] Petite info : {best} donnait mat en {mate} ! Ça arrive, on le note !"],
        "hang": ["[hmm] {Piece} est en prise ! {best} réglait tout, [chuckles] mais pas de panique !", "[sigh] {Piece} reste sans défense ! {best} était là, tu sais !"],
        "blunder": ["[gasps] Aïe aïe aïe ! {best} était LE coup, mais respire, on continue !", "[sigh] Ça arrive ! {best} était bien plus solide, retiens-le !"],
        "blunder_nobest": ["[gasps] Aïe ! Position pas simple, ça !", "[sigh] Ça arrive à tout le monde ! On repart, allez !"],
        "mistake": ["[hmm] Un peu imprécis ! {best} était plus juste, on le garde en tête !", "[clears throat] {best} aurait été plus confortable, hein !"],
        "brilliant": ["[excited] OH ! Très beau coup ! Je ne l'avais pas vu venir !", "[gasps] Brillant ! Là tu m'as vraiment surpris !", "[laugh] Bravo, sincèrement !"],
        "capture": ["[hmm] Une prise ! Bien vu !", "[chuckles] Ok ok, je te l'accorde !"],
        "check": ["[hmm] Échec ! Merci pour la politesse [laugh] !", "[excited] Oh, un échec ! Voyons voir..."],
        "castle": ["[excited] Le roque ! Roi à l'abri, super !", "[hmm] Roque... très raisonnable !"],
        "promo": ["[excited] Une promotion ! Félicitations, c'est énorme !"],
        "good": ["[hmm] Bon coup !", "[chuckles] Joli, continue comme ça !", "[excited] Solide !"],
        "normal": ["[hmm] Intéressant...", "[excited] Allez, on avance !", "[chuckles] Voyons voir...", "[hmm] Ok, ok !"],
        "victory": ["[excited] Belle partie ! On refait ça quand tu veux !", "[laugh] GG ! Merci pour ce moment, on relance ?"],
        "defeat": ["[laugh] Bravo, tu m'as eu ! Vraiment bien joué !", "[excited] GG ! Une très belle victoire !"],
        "draw": ["[chuckles] Nulle ! Partie équilibrée, comme on les aime !"],
        "catastrophe": [
            "[clears throat] Alors... [gasps] ce coup change énormément de choses ! Le meilleur, c'était {best}. [hmm] On continue ou on le reprend ?",
            "[gasps] Oh, attends attends attends ! {best} était bien meilleur ici ! Tu assumes, ou tu reprends ton coup ?",
            "[hmm] Là, la partie bascule ! {best} te gardait en jeu. On l'annule, ou tu continues ?",
        ],
        "takeback": ["[chuckles] Évidemment, reprends ton coup ! Prends ton temps !", "[excited] Aucun souci, on revient en arrière ! Allez, rejoue !", "[hmm] Annulé ! Une seconde chance, profites-en !"],
        "assume": ["[laugh] J'aime l'audace ! On continue !", "[hmm] Ok, on garde ce coup ! Voyons où ça mène...", "[chuckles] Tu assumes, c'est courageux !"],
        "trash_fallback": ["[laugh] Ah, j'adore l'ambiance ! Mais je reste concentré, hein !", "[excited] Ton ami a l'air sympa ! J'ai hâte de l'affronter aussi !", "[chuckles] Parle autant que tu veux, je ne bouge pas !"],
        "trash_focus": ["[laugh] Allez, retour à l'échiquier, c'est ton tour !", "[hmm] On bavarde bien, mais la position t'attend !", "[excited] Gentiment : joue ton coup, je t'attends !"],
        "resign": ["[exhales] Pas de souci ! Belle tentative, on recommence quand tu veux !", "[hmm] Tu abandonnes ? Parfois c'est sage ! On refait une partie ?", "[sigh] D'accord ! Merci d'avoir joué, vraiment !"],
    },
    "en": {
        "opening": ["[excited] {n}! A classic, I love it, we know the theory!", "{n} [hmm]... ok ok, solid play, I like it!", "[chuckles] {n}, the big classic! Let's develop!"],
        "mate_missed": ["[gasps] Wait, you had a mate in {mate} with {best}! [sigh] It was right there!", "[clears throat] Heads up: {best} was mate in {mate}! It happens, we note it!"],
        "hang": ["[hmm] {Piece} is hanging! {best} fixed everything, [chuckles] but no panic!", "[sigh] {Piece} is undefended! {best} was there, you know!"],
        "blunder": ["[gasps] Ouch ouch ouch! {best} was THE move, but breathe, we go on!", "[sigh] It happens! {best} was sturdier, remember it!"],
        "blunder_nobest": ["[gasps] Ouch! Tricky position, that one!", "[sigh] Happens to everyone! Let's go again!"],
        "mistake": ["[hmm] A bit imprecise! {best} was more accurate, keep it in mind!", "[clears throat] {best} would have been more comfortable, right!"],
        "brilliant": ["[excited] OH! Lovely move! I did not see that coming!", "[gasps] Brilliant! You really surprised me there!", "[laugh] Bravo, truly!"],
        "capture": ["[hmm] A capture! Nicely seen!", "[chuckles] Ok ok, I give you that!"],
        "check": ["[hmm] Check! Thanks for the courtesy [laugh]!", "[excited] Oh, a check! Let's see..."],
        "castle": ["[excited] Castling! King safe, great!", "[hmm] Castling... very reasonable!"],
        "promo": ["[excited] A promotion! Congratulations, that is huge!"],
        "good": ["[hmm] Good move!", "[chuckles] Nice, keep it up!", "[excited] Solid!"],
        "normal": ["[hmm] Interesting...", "[excited] Come on, we move on!", "[chuckles] Let's see...", "[hmm] Ok, ok!"],
        "victory": ["[excited] Great game! We can do it again anytime!", "[laugh] GG! Thanks for this moment, rematch?"],
        "defeat": ["[laugh] Bravo, you got me! Really well played!", "[excited] GG! A beautiful win!"],
        "draw": ["[chuckles] A draw! Balanced game, just how I like them!"],
        "catastrophe": [
            "[clears throat] So... [gasps] this move changes a LOT! The best was {best}. [hmm] Do we continue or take it back?",
            "[gasps] Oh, wait wait wait! {best} was much better here! Do you own it, or take it back?",
            "[hmm] The game swings here! {best} kept you in it. Undo it, or continue?",
        ],
        "takeback": ["[chuckles] Of course, take your move back! Take your time!", "[excited] No problem, we go back! Come on, replay!", "[hmm] Undone! A second chance, enjoy it!"],
        "assume": ["[laugh] I love the boldness! Let's go on!", "[hmm] Ok, we keep this move! Let's see where it leads...", "[chuckles] You own it, that is brave!"],
        "trash_fallback": ["[laugh] Ah, I love the atmosphere! But I stay focused, right!", "[excited] Your friend sounds nice! I cannot wait to play them too!", "[chuckles] Talk as much as you like, I am not going anywhere!"],
        "trash_focus": ["[laugh] Come on, back to the board, it is your turn!", "[hmm] We chat well, but the position is waiting for you!", "[excited] Nicely: play your move, I will wait!"],
        "resign": ["[exhales] No worries! Nice attempt, we can start again anytime!", "[hmm] You resign? Sometimes that is wise! Another game?", "[sigh] Alright! Thanks for playing, truly!"],
    },
}

# probabilité que la réplique soit PRONONCÉE (ElevenLabs) ; le sous-titre, lui, s'affiche toujours
VOICE_P = {"catastrophe": 1.0, "takeback": 1.0, "assume": 1.0, "resign": 1.0, "victory": 1.0, "defeat": 1.0, "draw": 1.0, "mate_missed": 1.0, "hang": 1.0, "blunder": 1.0, "blunder_nobest": 1.0,
           "brilliant": 1.0, "mate_announce": 1.0, "mistake": 0.45, "opening": 0.75, "check": 0.10, "capture": 0.08, "castle": 0.10, "promo": 0.5,
           "good": 0.06, "normal": 0.04}


def _pick(bank, last):
    pool = [t for t in bank if t != last] or bank
    return random.choice(pool)


def comment(ctx, lang="fr", last="", persona="enos"):
    """ctx : key (qualité), best (SAN local ou ''), mate (mat manqué en N ou None), hang (symbole de la pièce laissée en prise ou None),
    capture/check/castle/promo (bool), opening (entrée d'ouverture nouvellement reconnue ou None), end ('player_mate'|'engine_mate'|'draw'|None)."""
    lang = "en" if lang == "en" else "fr"
    bank = (BE if persona == "eto" else B)[lang]
    kind, text = None, None
    end = ctx.get("end")
    if ctx.get("force") in bank and not end:                          # situation imposée : gaffe catastrophique, takeback, gaffe assumée
        kind = ctx["force"]
    elif end == "engine_mate":
        kind = "victory"
    elif end == "player_mate":
        kind = "defeat"
    elif end == "draw":
        kind = "draw"
    elif end == "resign":
        kind = "resign"
    elif ctx["key"] in ("blunder", "mistake"):
        best = ctx.get("best") or ""
        if ctx["key"] == "blunder" and best and ctx.get("mate"):
            kind = "mate_missed"
        elif ctx["key"] == "blunder" and best and ctx.get("hang"):
            kind = "hang"
        elif best:
            kind = ctx["key"]
        else:
            kind = "blunder_nobest" if ctx["key"] == "blunder" else None
    elif ctx["key"] == "brilliant":
        kind = "brilliant"
    elif ctx.get("opening"):
        kind = "opening"
    elif ctx.get("promo"):
        kind = "promo"
    elif ctx.get("check"):
        kind = "check"
    elif ctx.get("castle"):
        kind = "castle"
    elif ctx.get("capture"):
        kind = "capture"
    elif ctx["key"] in ("best", "excellent", "good"):
        kind = "good"
    else:
        kind = "normal"
    if kind is None:
        kind = "normal"
    fields = {"best": ctx.get("best") or "", "mate": ctx.get("mate") or "", "mn": ctx.get("mate_n") or "", "n": "", "nl": "", "piece": "", "Piece": ""}
    if ctx.get("opening"):
        fields["n"] = _cap(ctx["opening"][lang])
        fields["nl"] = ctx["opening"][lang]
    if ctx.get("hang"):
        fields["piece"] = PIECE[lang][ctx["hang"].lower()]
        fields["Piece"] = _cap(fields["piece"])
    spoken = _pick(bank[kind], _tagged_of(last, bank[kind]) if persona == "eto" else last).format(**fields)
    text = _clean(spoken) if persona == "eto" else spoken          # l'écran n'affiche jamais les Audio Tags ; la voix d'ETO les reçoit (clé « speak »)
    return {"text": text, "speak": spoken if persona == "eto" else None, "kind": "victory" if kind == "mate_announce" else "defeat" if kind == "resign" else "blunder" if kind in ("catastrophe",) else "blunder" if kind in ("mate_missed", "hang", "blunder", "blunder_nobest", "mistake") else kind,
            "voice": random.random() < VOICE_P.get(kind, 0.05)}


def _clean(text):
    import nasko_persona
    return nasko_persona.clean(text)


def _tagged_of(last, bank):
    """`last` est un texte affiché (sans balises) : retrouve la réplique balisée correspondante pour éviter la répétition immédiate."""
    return next((t for t in bank if _clean(t) == last), last)


def trash_fallback(lang, focus, persona="enos"):
    """Réplique de secours (LLM indisponible) au trash talk du joueur. Retourne le texte (balisé pour ETO)."""
    return random.choice((BE if persona == "eto" else B)["en" if lang == "en" else "fr"]["trash_focus" if focus else "trash_fallback"])


def trash_system(lang, focus, persona="enos", guest=False):
    """Consigne du LLM pour le mode Trash Talk : arrogance, sarcasme, rage bait ; recadrage si le joueur insiste. ETO : poli, joueur, confiant.
    guest : un invité distant (écoute Discord) joue contre l'IA -> directive supplémentaire, et plus de « tais-toi et joue »."""
    import nasko_persona
    guest = guest or nasko_persona.guest_on()
    if persona == "eto":
        return nasko_persona.trash_prompt(lang, focus, guest)
    if guest:
        return _trash_system_enos(lang, False) + nasko_persona.guest_directive(lang, "enos")
    return _trash_system_enos(lang, focus)


def _trash_system_enos(lang, focus):
    if lang == "en":
        base = ("You are E.N.O.S., an arrogant, cold, sarcastic chess AI boss playing a game against the user. The user is talking to you by voice "
                "while you play (sometimes relaying what their friends say on Discord). Answer in ONE or TWO short sentences, plain text, no markdown: "
                "arrogant, sarcastic, rage-bait, mocking their play and their friends' remarks. Playful trash talk only: no slurs, no hate, no sexual "
                "content, no threats, nothing about real personal traits. If the user names a friend who thinks they can beat you, belittle that friend BY NAME (e.g. \"Your friend Leo will be swept away like the others\"). Use the game state you are given to mock their position. NEVER reveal a move, a plan or a hint about the game. Reply in English.")
        if focus:
            base += " The user keeps talking: end by ordering them to concentrate on the board."
        return base
    base = ("Tu es E.N.O.S., une IA d'échecs arrogante, glaciale et sarcastique, qui joue une partie contre l'utilisateur. Il te parle à voix haute "
            "pendant que tu joues (parfois pour répéter ce que disent ses amis sur Discord). Réponds en UNE ou DEUX phrases courtes, texte brut, sans markdown : "
            "arrogance, sarcasme, rage bait, moqueries sur son jeu et sur les remarques de ses amis. Du trash talk de jeu uniquement : aucune insulte "
            "discriminatoire, aucune haine, rien de sexuel, aucune menace, rien sur des traits personnels réels. Ne révèle JAMAIS un coup, un plan ni un "
            "indice sur la partie. S'il cite un ami qui pense pouvoir te battre, rabaisse cet ami PAR SON PRÉNOM (ex. « Ton ami Léo sera balayé comme les autres »). Appuie-toi sur l'état de la partie fourni pour railler sa position. Réponds en français.")
    if focus:
        base += " L'utilisateur insiste et bavarde : termine en lui ordonnant de se concentrer sur l'échiquier."
    return base
