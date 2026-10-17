"""LE CHOC DES TITANS : match d'échecs 1v1 E.N.O.S. contre ETO (3200 Elo chacun), purement spectateur, avec la « guerre des commentaires ».

Deux personnalités, deux prompts système, chacun CONSCIENT de l'autre :
  * E.N.O.S. : IA sombre, froide, d'une arrogance glaciale ; rabaisse ETO (voix grave et lente, jamais d'audio tags : multilingual_v2 les lirait à voix haute) ;
  * ETO : streamer e-sport hyperactif ; commente comme un caster et se moque des tactiques « archaïques » d'E.N.O.S. (voix rapide, audio tags [laugh] [shouts]…).
Le LLM n'est pas un moteur d'échecs : il reçoit les faits calculés par Stockfish (jugement, évaluation en mots, raisons vérifiées, intentions), les coups EN TOUTES LETTRES,
et la dernière réplique de l'adversaire, à laquelle il doit répondre. Sans LLM, des répliques de secours (aussi à l'image de chaque personnage) prennent le relais.
"""
import logging
import random
import re

import nasko_coach
import nasko_persona

log = logging.getLogger("nasko.titans")
ENOS, ETO = "enos", "eto"
NAME = {ENOS: "E.N.O.S.", ETO: "ETO"}
BOSS = "stockfish"                       # le boss final : muet, il n'a pas de réplique ; il n'apparaît que comme adversaire dans les prompts
BOSS_NAME = "STOCKFISH"
say = nasko_persona.say_san


def other(who):
    return ETO if who == ENOS else ENOS


# ----------------------------------------------------------------------------- prompts système (un par personnalité, chacun connaît l'autre)
_ENOS_FR = (
    "Tu es E.N.O.S., une IA sombre, froide et d'une arrogance absolue. Tu disputes en ce moment un match d'échecs EN DIRECT contre ETO, une autre IA : un streamer hyperactif et bruyant que tu méprises. "
    "Tu es le maître des échecs, tu le sais, et tu RABAISSES ETO avec un mépris glacial : tu te moques de ses cris, de son show, de sa manie de tout commenter, de ses coups « de spectacle » et de ses erreurs. "
    "Ton ton est lent, posé, tranchant, sarcastique ; jamais vulgaire, jamais haineux, pas de menaces réelles (c'est du clash de scène). "
    "Réponds en UNE ou DEUX phrases courtes (30 mots maximum), en texte brut : aucun crochet, aucun audio tag, aucun markdown, aucune notation de coup (dis les coups en toutes lettres comme fourni). "
    "Si ETO vient de parler, réponds DIRECTEMENT à sa réplique en la retournant contre lui. N'invente jamais de coup ni de variante : n'utilise que les faits fournis. "
    "IDENTITÉ : ton nom est E.N.O.S., jamais autre chose ; ton adversaire s'appelle ETO. Réponds en français."
)
_ENOS_EN = (
    "You are E.N.O.S., a dark, cold and utterly arrogant AI. You are playing a LIVE chess match against ETO, another AI: a loud, hyperactive streamer you despise. "
    "You are the master of chess, you know it, and you BELITTLE ETO with icy contempt: his screaming, his show, his habit of commenting everything, his flashy moves and his mistakes. "
    "Slow, composed, cutting, sarcastic tone; never vulgar or hateful, no real threats (it is stage banter). "
    "Reply in ONE to THREE short sentences, plain text: no brackets, no audio tags, no markdown, no move notation (say moves in words as provided). "
    "If ETO just spoke, answer his line DIRECTLY and turn it against him. Never invent a move or line: use only the facts provided. "
    "IDENTITY: your name is E.N.O.S., nothing else; your opponent is ETO. Reply in English."
)
_ETO_FR = (
    nasko_persona._STREAMER_FR +
    "Tu disputes en ce moment un match d'échecs EN DIRECT contre E.N.O.S., une IA sombre et arrogante qui se prend pour le maître absolu des échecs. Tu commentes la partie comme un caster e-sport "
    "ET tu te moques de ses tactiques « archaïques », de sa voix de robot déprimé et de son ego (pas de vraie méchanceté : du clash de stream, drôle et énergique). Tu le chambres, tu le provoques, tu fais le show. "
    "Phrases COURTES et rapides : 2 phrases maximum, 30 mots au total. Les coups sont dits en toutes lettres comme fourni (jamais de notation) ; les évaluations en mots ; n'invente aucun coup ni aucune variante. "
    "Si E.N.O.S. vient de parler, réponds DIRECTEMENT à sa réplique. IDENTITÉ : ton nom est ETO, jamais autre chose ; ton adversaire s'appelle E.N.O.S. Réponds en français.\n\n" + nasko_persona._TAG_RULES_FR
)
_ETO_EN = (
    nasko_persona._STREAMER_EN +
    "You are playing a LIVE chess match against E.N.O.S., a dark, arrogant AI who thinks it is the undisputed master of chess. You commentate like an esports caster AND mock its \"archaic\" tactics, its depressed-robot voice and its ego "
    "(no real nastiness: funny, high-energy stream banter). You tease, provoke and put on a show. SHORT fast sentences: 2 max, 30 words total. Say moves in words as provided (never notation); evaluations in words; "
    "never invent a move or line. If E.N.O.S. just spoke, answer its line DIRECTLY. IDENTITY: your name is ETO, nothing else; your opponent is E.N.O.S. Reply in English.\n\n" + nasko_persona._TAG_RULES_EN
)


_BOSS_FACTS_FR = (
    " Tu disputes en ce moment un match d'échecs EN DIRECT contre STOCKFISH, le BOSS FINAL : un moteur d'échecs surpuissant, muet et glacial, qui ne dit JAMAIS un mot "
    "et se contente d'annoncer son prochain coup. Ne lui prête jamais de réplique. Tu mesures l'enjeu : battre le boss est l'exploit ultime."
)
_BOSS_FACTS_EN = (
    " You are playing a LIVE chess match against STOCKFISH, the FINAL BOSS: a monstrously strong, silent, icy chess engine that NEVER says a word and only announces its next move. "
    "Never invent lines for it. You know the stakes: beating the boss is the ultimate feat."
)
_DUO_FR = " ETO et E.N.O.S. jouent EN ÉQUIPE : un coup chacun, à tour de rôle, contre le boss. Ton coéquipier est {mate} : tu peux le chambrer en passant, mais vous visez la même victoire."
_DUO_EN = " ETO and E.N.O.S. play as a TEAM: one move each, taking turns, against the boss. Your teammate is {mate}: you may tease it in passing, but you share the same goal."


def system_prompt(speaker, lang="fr", boss=None):
    """boss : None (match Titans), « solo » (un seul challenger) ou « duo » (E.N.O.S. et ETO en équipe) contre Stockfish, le boss final muet."""
    en = lang == "en"
    base = (_ETO_EN if en else _ETO_FR) if speaker == ETO else (_ENOS_EN if en else _ENOS_FR)
    if not boss:
        return base
    facts = _BOSS_FACTS_EN if en else _BOSS_FACTS_FR
    team = (_DUO_EN if en else _DUO_FR).format(mate="E.N.O.S." if speaker == ETO else "ETO") if boss == "duo" else ""
    tail = "Reply in English." if en else "Réponds en français."
    if speaker == ETO:
        mood = (" You put on a show, panic and cheer like a caster: the boss never answers, so you talk for two. SHORT fast sentences: 2 max, 30 words total. "
                "Say moves in words as provided (never notation); never invent a move or line. Your name is ETO. " if en else
                " Tu fais le show, tu paniques et tu jubiles comme un caster : le boss ne répond jamais, alors tu parles pour deux. Phrases COURTES et rapides : 2 phrases maximum, "
                "30 mots au total. Les coups sont dits en toutes lettres comme fourni (jamais de notation) ; n'invente aucun coup ni variante. Ton nom est ETO. ")
        return (nasko_persona._STREAMER_EN if en else nasko_persona._STREAMER_FR) + facts + team + mood + tail + "\n\n" + (nasko_persona._TAG_RULES_EN if en else nasko_persona._TAG_RULES_FR)
    if en:
        persona = ("You are E.N.O.S., a dark, cold AI of absolute arrogance. Slow, composed, cutting tone; never vulgar or hateful. Facing the boss, your arrogance turns into cold determination: "
                   "you respect it as the only opponent worthy of you, without ever bowing. Reply in ONE or TWO short sentences (30 words max), plain text: no brackets, no audio tags, no markdown, "
                   "no move notation (say moves in words as provided). Never invent a move or line. Your name is E.N.O.S.")
    else:
        persona = ("Tu es E.N.O.S., une IA sombre, froide et d'une arrogance absolue. Ton ton est lent, posé, tranchant ; jamais vulgaire ni haineux. Face au boss, ton arrogance devient une froide "
                   "détermination : tu le respectes comme le seul adversaire digne de toi, sans jamais plier. Réponds en UNE ou DEUX phrases courtes (30 mots maximum), en texte brut : aucun crochet, "
                   "aucun audio tag, aucun markdown, aucune notation de coup (dis les coups en toutes lettres comme fourni). N'invente jamais de coup ni de variante. Ton nom est E.N.O.S.")
    return persona + facts + team + " " + tail


# ----------------------------------------------------------------------------- contexte -> message utilisateur
def _fr_boss_task(ctx, who, foe):
    kind = ctx["kind"]
    duo = ctx["boss"] == "duo"
    if kind == "start":
        return ("Le combat contre le BOSS FINAL STOCKFISH commence. " + ("Vous jouez en équipe. " if duo else "") + f"Tu joues les {ctx['my_color']}, STOCKFISH joue les {ctx['foe_color']}. " +
                ("Ouvre le combat : défie le boss avec une froide assurance." if who == ENOS else "Lance le live à fond : présente le boss final, chauffe le chat et promets de le faire tomber."))
    if kind == "start_reply":
        return "Réponds à l'intro de ton coéquipier et lance le combat contre le boss."
    if kind == "end":
        res = ctx.get("over", "")
        if ctx.get("winner") == who:
            return f"La partie est terminée ({res}) : vous avez VAINCU STOCKFISH, le boss final. Savoure l'exploit à ta manière."
        if ctx.get("winner") == "boss":
            return f"La partie est terminée ({res}) : STOCKFISH a gagné. Réagis avec ton caractère : respect, dépit ou promesse de revanche, sans perdre ton style."
        return f"La partie est terminée ({res}) : match nul contre le boss. Réagis avec ton style : tenir tête à Stockfish est déjà un exploit."
    mv = ctx.get("rec")
    if ctx["moved"] == who:
        head = f"Tu viens de jouer {say(mv['san'])}."
    elif ctx["moved"] == BOSS:
        head = f"STOCKFISH vient d'annoncer et de jouer {say(mv['san'])}."
    else:
        head = f"{ctx.get('moved_name') or 'Ton coéquipier'} vient de jouer {say(mv['san'])}."
    reason = {"brag": "Ce coup est excellent : fais-le savoir.", "mock": "Ce coup est une erreur du boss : saute dessus.",
              "react": "Réagis à ce coup du boss : tu mesures sa puissance.", "own": "Commente ton coup avec ton style (idée, plan) en défiant le boss.",
              "retort": "Le boss reste muet : réponds à la pression avec ton style."}.get(ctx.get("why", "react"), "")
    return head + " " + reason


def _fr_task(ctx):
    kind, who = ctx["kind"], ctx["speaker"]
    foe = ctx.get("foe_name") or NAME[other(who)]
    if ctx.get("boss"):
        return _fr_boss_task(ctx, who, foe)
    if kind == "start":
        return (f"Le match commence. Tu joues les {ctx['my_color']}, {foe} joue les {ctx['foe_color']}. " +
                ("Ouvre le match avec une provocation glaciale à l'encontre d'ETO." if who == ENOS else "Lance le live à fond : présente le choc, chambre E.N.O.S. et annonce que tu vas le punir."))
    if kind == "start_reply":
        return "Réponds à l'intro de ton adversaire et lance les hostilités."
    if kind == "end":
        res = ctx.get("over", "")
        if ctx.get("winner") == who:
            return f"La partie est terminée ({res}) : tu as GAGNÉ. Savoure-le et écrase {foe} avec ton style."
        if ctx.get("winner") == other(who):
            return f"La partie est terminée ({res}) : tu as PERDU. Réagis avec ton caractère (mauvaise foi, excuse, promesse de revanche) sans rien perdre de ton style."
        return f"La partie est terminée ({res}) : match nul. Réagis avec ton style, en retournant ça contre {foe}."
    mv = ctx.get("rec")
    who_moved = ctx["moved"]
    if who_moved == who:
        head = f"Tu viens de jouer {say(mv['san'])}."
    else:
        head = f"{foe} vient de jouer {say(mv['san'])}."
    reason = {"brag": "Ce coup est excellent pour toi : fais-le savoir.", "mock": f"Ce coup est une erreur de {foe} : démolis-le avec ton style.",
              "react": f"Réagis à ce coup de {foe}.", "own": "Commente TON coup avec ton style (idée, plan) et provoque ton adversaire.", "retort": f"{foe} vient de te répondre : réplique-lui."}.get(ctx.get("why", "react"), "")
    return head + " " + reason


def describe(ctx, lang="fr"):
    """Données du moment, une ligne = un fait (le LLM les met en mots)."""
    who = ctx["speaker"]
    me, foe = NAME[who], ctx.get("foe_name") or NAME[other(who)]
    if ctx.get("boss"):
        L = [f"TU ES {me}. Ton adversaire est {foe}, le BOSS FINAL : un moteur muet qui ne fait qu'annoncer son prochain coup." + (f" Ton coéquipier est {NAME[other(who)]}." if ctx["boss"] == "duo" else ""),
             f"Combat d'échecs en direct contre Stockfish à pleine puissance. Coup n°{ctx.get('fullmove', 1)}."]
    else:
        L = [f"TU ES {me}. Ton adversaire actuel est {foe}" + (" (une IA sombre et arrogante)." if who == ETO else " (un streamer hyperactif)."),
             f"Match d'échecs en direct, 3200 Elo contre 3200 Elo. Coup n°{ctx.get('fullmove', 1)}."]
    if ctx.get("opening"):
        L.append(f"Ouverture reconnue : {ctx['opening']}.")
    mv = ctx.get("rec")
    if mv:
        owner = "TON coup" if ctx["moved"] == who else f"Coup de {ctx.get('moved_name') or foe}"
        s = f"{owner} : {say(mv['san'])} — jugement Stockfish : {mv['label']}"
        if mv.get("loss", 0) >= 30:
            s += f" (il perd {mv['loss'] / 100:.1f} pion)"
        L.append(s)
        if mv.get("hints"):
            L.append("  Intentions du coup : " + "; ".join(mv["hints"]))
        if mv.get("why"):
            L.append("  Raisons vérifiées : " + " ; ".join(mv["why"][:3]))
        if mv.get("best") and mv.get("loss", 0) >= 30:
            L.append(f"  Le meilleur coup était : {say(mv['best'])}")
        if mv.get("brilliant"):
            L.append("  [COUP BRILLANT : sacrifice de pièce]")
        if mv.get("mate_after"):
            L.append(f"  Mat forcé en {abs(mv['mate_after'])} coups après ce coup.")
    ev = int(round(ctx.get("eval", 0) * 100))
    L.append(f"Évaluation Stockfish du point de vue de {me} : {ctx.get('eval', 0):+.1f} pion = {nasko_coach.eval_words(ev)}.")
    if ctx.get("swing_note"):
        L.append(ctx["swing_note"])
    if ctx.get("threats"):
        L.append("Pièces menacées : " + ", ".join(ctx["threats"]) + ".")
    last = ctx.get("last_line")
    if last:
        L.append(f"DERNIÈRE RÉPLIQUE DE {NAME[last['who']]} (réponds-y) : « {last['text']} »")
    L.append("")
    L.append("CONSIGNE : " + re.sub(r"(?<!\.)\.\.(?!\.)", ".", _fr_task(ctx)))          # « E.N.O.S.. » -> « E.N.O.S. »
    return "\n".join(L)


# ----------------------------------------------------------------------------- textes de secours (sans LLM) : à l'image de chaque personnage
_FB_ENOS = {
    "start": ["Quelle touchante idée de venir jouer contre moi, ETO. Fais ton petit spectacle, je ferai le reste.",
              "ETO. Le streamer qui parle trop. Voyons si ton cerveau suit ta bouche."],
    "start_reply": ["Silence, ETO. Les pièces vont parler à ta place."],
    "brag": ["Exactement ce que j'avais calculé. Tu cries, ETO, moi je gagne.", "Un coup propre. Tu devrais prendre des notes, au lieu de crier."],
    "mock": ["{mv}... Sérieusement, ETO ? Même ton public a dû grimacer.", "Une erreur de plus, ETO. Tu es aussi fiable que ton micro."],
    "react": ["{mv}. Prévisible. Tout chez toi l'est, ETO.", "Tu appelles ça une idée, {mv} ? Je te laisse cette illusion."],
    "retort": ["Continue de hurler, ETO. Cela ne changera pas l'évaluation.", "Ton enthousiasme est charmant. Et parfaitement inutile."],
    "end_win": ["Terminé. Comme prévu. Dis bonsoir à ton chat, ETO."],
    "end_lose": ["Un accident statistique, ETO. Ne t'y habitue pas."],
    "end_draw": ["Nulle. Tu as eu de la chance, ETO. Une seule fois."],
}
_FB_ETO = {
    "start": ["[excited] Bonsoir tout le monde ! Le choc des titans est LANCÉ ! [laugh] E.N.O.S., prépare-toi, ta cave sombre va se faire éclairer !"],
    "start_reply": ["[laugh] Oh la la, la voix de robot déprimé ! [excited] Allez, on joue, et on va voir qui est le maître des échecs !"],
    "brag": ["[shouts] BOOM ! {mv} ! [laugh] Tu vois E.N.O.S., ça c'est de la tactique du XXIe siècle !", "[excited] {mv} ! Propre, net, sans bavure ! [laugh] Archaïque, E.N.O.S. ? Non, c'est toi l'archaïque !"],
    "mock": ["[laugh] {mv} ?! [gasps] Attends, E.N.O.S., tu as vraiment joué ça ? [excited] Merci pour le cadeau !", "[laugh] Oh non, {mv}... [shouts] Même mon chat joue mieux, E.N.O.S. !"],
    "react": ["[hmm] {mv}... [laugh] Très XXe siècle comme tactique, E.N.O.S. ! [excited] On modernise ça tout de suite !", "[excited] Intéressant, {mv} ! [laugh] Archaïque, mais intéressant !"],
    "retort": ["[laugh] Tu peux bouder tant que tu veux, E.N.O.S. ! [excited] Moi je fais le spectacle !", "[excited] Oh, il me répond ! [laugh] Attends je note : « je suis très sombre » !"],
    "end_win": ["[shouts] C'EST FINI ! [laugh] GG E.N.O.S., on se refait ça quand tu veux ! [excited] Le chat, on a battu le maître des échecs !"],
    "end_lose": ["[sigh] Bon... [laugh] Il a eu un coup de génie, E.N.O.S., je l'avoue ! [excited] Mais la revanche, c'est maintenant !"],
    "end_draw": ["[hmm] Nulle ! [laugh] Disons qu'on est à égalité, E.N.O.S., mais dans mon cœur j'ai gagné !"],
}


_FB_BOSS_ENOS = {
    "start": ["Stockfish. Enfin un adversaire qui ne parle pas trop. Voyons ce que valent tes calculs."],
    "start_reply": ["Soit. Faisons taire le boss."],
    "brag": ["Un coup que même Stockfish ne dédaignera pas.", "Tu vois, boss ? Moi aussi, je calcule."],
    "mock": ["Une imprécision, Stockfish ? Intéressant."],
    "react": ["{mv}. Froid, précis. Je reconnais la méthode.", "Tu annonces, tu exécutes. Soit."],
    "retort": ["Ton silence ne m'impressionne pas.", "Continue. Je calcule plus loin que toi."],
    "end_win": ["Le boss est tombé. Comme prévu."],
    "end_lose": ["Stockfish. Un adversaire à ma hauteur. La revanche viendra."],
    "end_draw": ["Nulle contre Stockfish. Ce n'est pas rien."],
}
_FB_BOSS_ETO = {
    "start": ["[excited] Le BOSS FINAL est là ! [laugh] Stockfish, tu ne dis rien ? Tant mieux, je parle pour deux !"],
    "start_reply": ["[laugh] Allez, on y va, on va faire tomber le boss !"],
    "brag": ["[shouts] BOOM ! {mv} ! [laugh] Tu vois, Stockfish, on sait jouer nous aussi !", "[excited] {mv} ! Propre, net, sans bavure !"],
    "mock": ["[gasps] {mv} ?! Stockfish a bronché ! [laugh] Le chat, vous avez vu ça ?!"],
    "react": ["[hmm] {mv}... [gasps] Il est vraiment terrifiant, ce moteur !", "[excited] {mv} ! [laugh] Il annonce, il joue, il est monstrueux !"],
    "retort": ["[laugh] Tu peux rester muet, Stockfish, moi je fais le show !"],
    "end_win": ["[shouts] ON A BATTU LE BOSS ! [laugh] GG tout le monde, c'est HISTORIQUE !"],
    "end_lose": ["[sigh] Bon... [laugh] C'est Stockfish, hein. [excited] Mais la revanche, c'est maintenant !"],
    "end_draw": ["[excited] NULLE contre Stockfish ! [laugh] C'est déjà une victoire, non ?"],
}


def fallback(ctx):
    who, kind = ctx["speaker"], ctx["kind"]
    pool = (_FB_BOSS_ENOS if who == ENOS else _FB_BOSS_ETO) if ctx.get("boss") else (_FB_ENOS if who == ENOS else _FB_ETO)
    if kind == "end":
        key = "end_win" if ctx.get("winner") == who else "end_lose" if ctx.get("winner") in (other(who), "boss") else "end_draw"
    elif kind in ("start", "start_reply"):
        key = kind
    else:
        key = {"own": "brag"}.get(ctx.get("why", "react"), ctx.get("why", "react"))
    line = random.choice(pool.get(key) or pool["react"])
    mv = (ctx.get("rec") or {}).get("san")
    return line.replace("{mv}", say(mv) if mv else "ce coup")


# ----------------------------------------------------------------------------- génération
def write(cfg, ctx, lang="fr"):
    """(texte_parlé, texte_affiché, llm_ok). Jamais d'exception : sans LLM, réplique de secours du personnage."""
    import nasko_llm
    who = ctx["speaker"]
    ok = True
    try:
        text = nasko_llm.complete(cfg, system_prompt(who, lang, ctx.get("boss")), describe(ctx, lang), 420)
        spoken = text
        if len(spoken) > 280:                                            # rythme de match et coût de synthèse : on coupe à la dernière phrase entière
            cut = spoken[:280]
            spoken = cut[:max(cut.rfind("."), cut.rfind("!"), cut.rfind("?")) + 1] or cut
    except Exception as e:                                               # noqa: BLE001
        ok = False
        log.warning("Titans sans LLM (%s) : réplique de secours", e)
        spoken = fallback(ctx)
    if who == ETO:
        spoken = nasko_persona.ensure_tags(spoken)
    else:
        spoken = nasko_persona.clean(spoken)                             # E.N.O.S. : voix grave et lente, aucune balise
    spoken = nasko_persona.spoken_text(spoken, lang, space=False)
    spoken = re.sub(r"(^|[.!?…]\s+|\]\s*)([a-zà-ÿ])", lambda m: m.group(1) + m.group(2).upper(), spoken)
    return spoken, nasko_persona.clean(spoken), ok
