"""COACH ETO : commentaire en direct d'une partie d'échecs, façon streamer passionné ET pédagogue.

Trois usages : COURS (l'élève joue contre un bot virtuel, ETO commente), DÉFI (ETO aide pendant un duel contre E.N.O.S.), SPEEDRUN (ETO, 3200 Elo, joue
lui-même contre un bot à l'Elo choisi et commente SES coups et les erreurs du bot en direct).

Le LLM n'est pas un moteur d'échecs : il reçoit tout ce que Stockfish a calculé (évaluation avant/après le coup, meilleure ligne, suite conseillée, mat, pièces
menacées) ET les raisons vérifiées sur l'échiquier (« l'adversaire peut gagner la dame en d4 », « la pièce déplacée est menacée »…), et il les met en mots.
Les coups lui sont donnés EN TOUTES LETTRES (« fou en e3 », « fou prend en h6 ») : jamais de notation à épeler. Sans LLM, un texte de secours pédagogique est
construit à partir des mêmes données (même structure : le coup, pourquoi, le meilleur coup, comment on punit).
"""
import logging
import re

import nasko_persona

log = logging.getLogger("nasko.coach")
say = nasko_persona.say_san                                          # « Fxh6 » -> « fou prend en h6 »

STYLE_FR = (
    nasko_persona._STREAMER_FR +
    "Tu commentes une partie d'échecs EN DIRECT et tu es PÉDAGOGUE : tu ne lis jamais les coups, tu EXPLIQUES. Pour chaque coup commenté : 1) dis le coup en toutes lettres, "
    "2) explique POURQUOI il est bon ou mauvais en t'appuyant sur les RAISONS fournies (matériel, pièce menacée, échec, mat, cases affaiblies, plan), 3) si c'est une erreur : donne le MEILLEUR coup et ce qu'il "
    "apporte, 4) dis comment on punit ou on exploite. RÈGLES STRICTES : n'utilise QUE les coups, lignes et faits fournis (aucune variante inventée) ; dis les coups EXACTEMENT sous la forme en toutes lettres fournie "
    "(« fou en e3 », « fou prend en h6 », « cavalier en f3 »), JAMAIS en notation (pas de « Fe3 », « Cf3 », « fxe4 ») ; dis les évaluations en mots (« un pion et demi d'avance », « position égale », « presque gagné »), "
    "jamais en chiffres signés ; les crochets [ ] servent UNIQUEMENT aux audio tags, jamais autour d'un coup ni d'un mot ; parle à l'ORAL, phrases complètes et vivantes (jamais télégraphique), commence par un audio tag ou une interjection ; 2 à 3 phrases COURTES (40 mots maximum : le jeu doit avancer, ne fais jamais de discours), texte brut, sans markdown ni liste. "
)
STYLE_EN = (
    nasko_persona._STREAMER_EN +
    "You are commentating a chess game LIVE and you TEACH: never read moves, EXPLAIN. For each commented move: 1) say the move in words, 2) explain WHY it is good or bad using the REASONS provided "
    "(material, threatened piece, check, mate, weakened squares, plan), 3) if it is a mistake: give the BEST move and what it brings, 4) say how we punish or exploit it. STRICT RULES: use ONLY the moves, lines "
    "and facts provided; say moves EXACTLY in the spelled-out form provided (\"bishop to e3\"), NEVER in notation; say evaluations in words, never signed numbers; 3 to 5 SHORT sentences (60 words max), plain text. "
)

TASKS_FR = {
    "coach": "Commente le dernier échange entre l'élève et le bot virtuel. Si l'élève a fait une erreur : dédramatise vite, dis POURQUOI c'est une erreur (raisons fournies), donne le meilleur coup et ce que le bot va faire pour en profiter (ligne fournie). "
             "Si le BOT a fait une erreur : explique-la et montre comment la punir (ligne fournie). Sinon, explique l'idée du coup du bot et ce qu'il faut surveiller. ",
    "enos": "ENOS, l'adversaire agressif, vient de jouer. Aide l'élève à comprendre ses coups agressifs (menaces, idée) et propose une défense simple et concrète à partir des données. "
            "Si l'élève vient de faire une erreur, explique pourquoi sans le juger. ",
    "start": "La partie commence : lance le live avec énergie, présente le bot (son niveau) et donne en deux phrases les trois principes du début de partie (centre, développement, roque). ",
    "end": "La partie est terminée : fais un bilan plein d'énergie (ce qui a bien marché, UNE chose à travailler, selon les données) et propose de relancer. ",
    "ask": "L'élève te pose une question pendant la partie : réponds en coach de stream, avec la position et les données. Ne donne pas directement le meilleur coup : explique l'idée et laisse-le le trouver, sauf s'il le demande. ",
    "setup": "MISE EN CONDITION : l'élève a posé une position libre sur l'échiquier (aucune partie en cours) et te pose une question, souvent hypothétique (« si mon adversaire fait ça, que dois-je faire ? »). "
             "Réponds à SA question en t'appuyant UNIQUEMENT sur les lignes Stockfish et les faits fournis : le coup recommandé (en toutes lettres), l'IDÉE derrière, et la réponse que l'adversaire peut attendre. "
             "Si la question suppose un coup qui n'est pas dans les lignes fournies, ne l'invente pas : explique le plan général d'après les lignes et invite l'élève à JOUER ce coup sur l'échiquier (champ « coups ») pour que tu analyses la vraie position. Jusqu'à 90 mots. ",
    "sr_start": "Tu lances un SPEEDRUN : tu vas jouer toi-même (3200 Elo) contre un bot, devant un spectateur. Présente le bot et son niveau, annonce ta couleur et ton plan d'ouverture en deux ou trois phrases, avec de l'ego et de la bonne humeur. ",
    "sr_eto": "Tu viens de jouer TON coup. STRUCTURE EN DEUX TEMPS : d'abord annonce TON coup en toutes lettres (« je joue cavalier en d2 »), puis la RÉPONSE que tu attends du bot en la nommant en toutes lettres (« normalement il va jouer … »). Dis le coup en toutes lettres, annonce ton PLAN et justifie-le (idée, case visée, menace créée) avec les intentions et l'évaluation fournies, puis dis ce que tu attends du bot (ligne fournie). "
              "Si le bot a fait une imprécision juste avant, dis-le et montre que tu la punis. Si un mat est forcé, annonce-le avec jubilation. ",
    "sr_bot": "Le BOT vient de jouer. Dis son coup en toutes lettres. Si c'est une imprécision, une erreur ou une gaffe : explique POURQUOI (raisons fournies), dis que c'est typique à son Elo, donne le MEILLEUR coup qu'il aurait dû jouer, "
              "puis annonce avec énergie comment tu vas la PUNIR (coup fourni). Sinon, reconnais le coup en une phrase et dis ce que tu surveilles. ",
    "sr_end": "La partie est terminée : fais le bilan du speedrun en streamer (comment tu as gagné ou ce qui s'est passé, les erreurs clés du bot, ce que le spectateur peut retenir) et lance la partie suivante. ",
}
TASKS_EN = {
    "coach": "Comment on the last exchange between the student and the virtual bot. If the student erred: defuse fast, say WHY (reasons provided), give the best move and what the bot will do to exploit it. If the BOT erred: explain and show how to punish. Otherwise explain the bot's idea. ",
    "enos": "ENOS, the aggressive opponent, just played. Help the student understand its aggressive moves and suggest a simple, concrete defense from the data. If the student erred, explain why without judging. ",
    "start": "The game starts: kick off the live with energy, introduce the bot (its level) and give the three opening principles in two sentences. ",
    "end": "The game is over: energetic debrief (what worked, ONE thing to practice) and offer a rematch. ",
    "ask": "The student asks you a question mid-game: answer as a stream coach using the position and data. Do not give the best move directly unless asked. ",
    "setup": "SETUP MODE: the student set up a free position (no game running) and asks a question, often hypothetical (\"if my opponent does this, what should I do?\"). Answer THEIR question using ONLY the Stockfish lines and facts provided: "
             "the recommended move (in words), the IDEA behind it, and the reply the opponent can expect. If the question assumes a move that is not in the lines, do not invent it: explain the general plan and invite the student to PLAY that move on the board (\"moves\" field) so you analyse the real position. Up to 90 words. ",
    "sr_start": "You start a SPEEDRUN: you play (3200 Elo) against a bot in front of a viewer. Introduce the bot and its level, announce your color and opening plan in two or three sentences, with ego and good mood. ",
    "sr_eto": "You just played YOUR move. Say it in words, announce your PLAN and justify it (idea, target square, threat) using the intentions and evaluation provided, then say what you expect from the bot. If the bot erred just before, say so. If a mate is forced, announce it gleefully. ",
    "sr_bot": "The BOT just played. Say its move in words. If it is an inaccuracy, mistake or blunder: explain WHY (reasons provided), say it is typical at its Elo, give the BEST move it should have played, then announce how you will PUNISH it (move provided). Otherwise acknowledge it in one sentence. ",
    "sr_end": "The game is over: speedrun debrief as a streamer and launch the next game. ",
}


HYPE_FR = (
    "\n\n[SITUATION: SACRIFICE DE PIÈCE BRILLANT] ALERTE HYPE ABSOLUE : un coup BRILLANT (sacrifice de pièce) vient d'être joué. Tu t'enflammes comme un commentateur e-sport en plein clutch : "
    "« BOOM ! », « Oh la masterclass ! », « Regardez-moi CE sacrifice ! », « Mais c'est pas possible ! ». Phrases courtes et explosives, des mots en MAJUSCULES pour crier. Justifie la BEAUTÉ du sacrifice avec les "
    "données (la pièce donnée, ce qu'elle rapporte : mat forcé ou gros avantage, la ligne). Audio tags les plus explosifs : [shouts], [excited], [gasps], [laugh]. 3 à 5 phrases, 60 mots maximum. "
    "Exemple de ton : « [shouts] BOOM ! Regardez-moi ce sacrifice : la DAME en pâture ! [gasps] S'il la prend, c'est mat en deux ! [excited] Oh la MASTERCLASS, on ne la refait pas ! » "
)
HYPE_EN = (
    "\n\n[SITUATION: BRILLIANT PIECE SACRIFICE] ABSOLUTE HYPE ALERT: a BRILLIANT move (piece sacrifice) was just played. You erupt like an esports caster in a clutch moment: \"BOOM!\", \"Oh, the masterclass!\", "
    "\"Look at THAT sacrifice!\", \"This is unreal!\". Short explosive sentences, words in CAPS to shout. Justify the BEAUTY of the sacrifice with the data (the piece given, what it brings: forced mate or big edge, the line). "
    "Most explosive audio tags: [shouts], [excited], [gasps], [laugh]. 3 to 5 sentences, 60 words max. "
)


def eval_words(cp):
    """Évaluation (centipions, point de vue de celui dont on parle) -> mots, pour que personne ne lise « plus deux virgule cinq »."""
    a = abs(cp)
    if a >= 9000:
        return "mat forcé " + ("pour lui" if cp > 0 else "contre lui")
    side = "d'avance" if cp > 0 else "de retard"
    if a < 30:
        return "position à peu près égale"
    if a < 90:
        return "léger avantage" if cp > 0 else "léger désavantage"
    if a < 180:
        return "environ un pion " + side
    if a < 280:
        return "environ deux pions " + side
    if a < 450:
        return "plus de deux pions " + side + " : position " + ("très bonne" if cp > 0 else "très difficile")
    return "position " + ("quasiment gagnée" if cp > 0 else "quasiment perdue")


def eval_sentence(cp):
    """Évaluation -> phrase complète de coach (pour le texte de secours)."""
    w = eval_words(cp)
    if w.startswith("position à peu près"):
        return "La position est à peu près égale. "
    if w.startswith(("léger avantage", "environ", "plus de")) and cp > 0:
        return "On a " + ("un " + w if w.startswith("léger") else w) + ". "
    if w.startswith(("léger désavantage", "environ", "plus de")):
        return "On est un peu moins bien : " + w + ". "
    if w.startswith("mat"):
        return "C'est " + w + " ! "
    return "On est en " + w + " ! "


def _intent(hints):
    """Intentions utiles à dire : on retire la redite « le pion vers e4 » (le coup est déjà annoncé)."""
    return [h for h in (hints or []) if " vers " not in h]


def _line(moves):
    return " ; ".join(say(m) for m in moves) if moves else "—"


def describe(p, lang="fr"):
    """Données de la partie en texte clair pour le LLM (une ligne = un fait), coups en toutes lettres."""
    sr = p.get("mode") == "speedrun"
    L = []
    if p.get("setup"):
        L.append(f"MISE EN CONDITION : position libre posée par l'élève (pas de partie en cours). L'élève joue les {p.get('me_name')} ; le trait est aux {p.get('turn_name')}.")
    elif sr:
        L.append(f"SPEEDRUN : ETO (3200 Elo) joue les {p.get('me_name')} contre {p.get('opponent')}. Coup n°{p.get('fullmove')}. Tu commentes TA partie en direct pour un spectateur.")
    else:
        L.append(f"Adversaire : {p.get('opponent')}. L'élève joue les {p.get('me_name')}. Coup n°{p.get('fullmove')}.")
    if p.get("opening"):
        L.append(f"Ouverture reconnue : {p['opening']}.")
    sit = p.get("situation")
    if sit:                                                          # alerte placée en tête : le LLM doit la voir en premier
        who = {"mine": "ETO" if sr else "l'élève", "theirs": "le bot" if sr else "l'adversaire"}.get(sit["who"], "")
        sac = sit.get("sacrifice") or {}
        L.insert(0, f"[SITUATION: SACRIFICE DE PIÈCE BRILLANT] Coup brillant (!!) joué par {who} : {say(sit['san'])}"
                    + (f", sacrifice de {sac['piece']} (déficit de {sac['deficit']} pions)" if sac.get("piece") else "")
                    + (f", mat forcé en {sac['mate']} coups" if sac.get("mate") else (f", évaluation ensuite {sac['cp'] / 100:+.1f}" if sac.get("cp") is not None else "")) + ".")
    pov = "d'ETO" if sr else "de l'élève"
    ev = int(round(p.get("eval", 0) * 100))
    L.append(f"Évaluation Stockfish actuelle (point de vue {pov}) : {p.get('eval', 0):+.1f} pion = {eval_words(ev)}.")
    if p.get("fen"):
        L.append(f"Position actuelle (FEN) : {p['fen']}")
    for i, ln in enumerate(p.get("lines") or [], 1):                 # mise en condition : les 3 meilleures lignes de Stockfish pour le camp au trait
        L.append(f"Ligne Stockfish n°{i} (camp au trait, évaluée du point de vue de l'élève) : {_line(ln['line'])} — "
                 + (f"mat forcé en {abs(ln['mate'])} coups" + (" pour l'élève" if ln["mate"] > 0 else " contre l'élève") if ln.get("mate") else eval_words(ln["cp"])))
    labels = (("mine", "TON coup (ETO)"), ("theirs", "Coup du BOT")) if sr else (("mine", "Dernier coup de l'élève"), ("theirs", "Dernier coup de l'adversaire"))
    for key, who in labels:
        m = p.get(key)
        if not m:
            continue
        s = f"{who} : {say(m['san'])} — jugement Stockfish : {m['label']}"
        if m["loss"] >= 30:
            s += f" (il perd {m['loss'] / 100:.1f} pion ; évaluation de {eval_words(m['before'])} à {eval_words(m['after'])} pour celui qui a joué)"
        L.append(s)
        if m.get("hints"):
            L.append("  Intentions du coup : " + "; ".join(m["hints"]))
        if m.get("why"):
            L.append("  RAISONS vérifiées sur l'échiquier : " + " ; ".join(m["why"]))
        if m.get("best"):
            L.append(f"  Le MEILLEUR coup (Stockfish) était : {say(m['best'])} ; ligne conseillée : {_line(m.get('pv_best'))}")
        if m.get("pv_after"):
            L.append(f"  Meilleure suite pour l'autre camp après ce coup : {_line(m['pv_after'])}")
        if m.get("mate_after"):
            side = "contre celui qui l'a joué" if m["mate_after"] < 0 else "pour celui qui l'a joué"
            L.append(f"  Après ce coup, un mat est forcé en {abs(m['mate_after'])} coups ({side}).")
    if p.get("my_hanging"):
        L.append(("Tes pièces menacées : " if sr else "Pièces de l'élève menacées : ") + ", ".join(p["my_hanging"]) + ".")
    if p.get("their_hanging"):
        L.append(("Pièces du bot menacées : " if sr else "Pièces de l'adversaire menacées : ") + ", ".join(p["their_hanging"]) + ".")
    if p.get("check") and not sr:
        L.append("L'élève est en échec.")
    if p.get("stats"):
        L.append("Bilan jusqu'ici : " + p["stats"])
    if p.get("over"):
        L.append("Résultat : " + p["over"] + ".")
    if p.get("question"):
        L.append("Question de l'élève : « " + p["question"] + " »")
    return "\n".join(L)


# ----------------------------------------------------------------------------- texte de secours (sans LLM) : pédagogique, avec les mêmes données
def _why_text(m):
    w = [x for x in (m.get("why") or []) if "évaluation passe" not in x]
    return (w[0][0].upper() + w[0][1:] + ". ") if w else ""


def fallback(task, p):
    mine, theirs = p.get("mine"), p.get("theirs")
    opp = p.get("opponent", "le bot")
    elo = p.get("bot_elo", "")
    bad = {"inaccuracy", "mistake", "blunder"}
    sit = p.get("situation")
    if sit and task != "ask":                                        # texte de secours en mode hype : même énergie, mêmes données
        who = {"mine": "ETO" if p.get("mode") == "speedrun" else "toi", "theirs": "le bot" if p.get("mode") == "speedrun" else "l'adversaire"}.get(sit["who"], "")
        sac = sit.get("sacrifice") or {}
        s = f"[shouts] BOOM ! [gasps] Regardez-moi CE coup : {say(sit['san'])} ! "
        if sac.get("piece"):
            s += f"[excited] {who.capitalize()} sacrifie {sac['piece']} ! "
        s += ("[laugh] Mat forcé en " + str(sac["mate"]) + " coups, c'est une MASTERCLASS !" if sac.get("mate") else "[laugh] Oh la masterclass, l'avantage est énorme !")
        return s
    if task == "setup":
        lines = p.get("lines") or []
        if not lines:
            return "[hmm] Cette position est terminée, il n'y a plus rien à jouer. [excited] Modifie-la et repose-moi ta question !"
        top = lines[0]
        s = f"[hmm] Dans cette position, le coup que je recommande, c'est {say(top['line'][0])}. "
        s += (f"[excited] C'est même un mat forcé en {abs(top['mate'])} coups pour toi ! " if top.get("mate") and top["mate"] > 0 else eval_sentence(top["cp"]))
        if len(top["line"]) > 1:
            s += f"[excited] L'adversaire va sûrement répondre {say(top['line'][1])}. "
        if len(lines) > 1:
            s += f"Sinon, {say(lines[1]['line'][0])} est une alternative."
        return s
    if task == "start":
        return f"[excited] C'est parti ! Aujourd'hui tu joues contre {opp}, et moi je commente en direct. [clears throat] Les trois règles : le centre, le développement, et on roque !"
    if task == "sr_start":
        return f"[excited] Allez, speedrun ! Je joue les {p.get('me_name')} contre {opp}. [laugh] Mon plan : le centre, mes pièces dehors, et on guette la moindre imprécision !"
    if task in ("end", "sr_end"):
        return "[excited] Et voilà, partie terminée ! [hmm] On retient une idée, une seule, et on relance direct !"
    if task == "ask":
        return "[hmm] Bonne question ! Regarde quelles pièces sont menacées, puis lesquelles de tes pièces ne font encore rien... [excited] C'est souvent là que se cache le plan !"
    if task == "sr_eto" and mine:
        s = f"[excited] {say(mine['san']).capitalize()} ! "
        it = _intent(mine.get("hints"))
        if it:
            s += "L'idée : " + " et ".join(it[:2]) + ". "
        s += eval_sentence(mine["after"])
        if mine.get("mate_after") and mine["mate_after"] > 0:
            s += f"[laugh] Et attends : mat forcé en {mine['mate_after']} coups ! "
        elif mine.get("pv_after"):
            s += f"[hmm] S'il répond {say(mine['pv_after'][0])}..."
            if len(mine["pv_after"]) > 1:
                s += f" on enchaîne avec {say(mine['pv_after'][1])} !"
        return s
    if task == "sr_bot" and theirs:
        if theirs["key"] in bad:
            kind = {"blunder": "une énorme gaffe", "mistake": "une vraie erreur"}.get(theirs["key"], "une imprécision")
            s = f"[laugh] Aïe ! {say(theirs['san']).capitalize()}, c'est {kind}, typique à {elo} Elo ! " + _why_text(theirs).replace("l'adversaire peut", "on peut")
            if theirs.get("best"):
                s += f"Il fallait jouer {say(theirs['best'])}. "
            if theirs.get("pv_after"):
                s += f"[excited] Nous, on punit direct avec {say(theirs['pv_after'][0])} !"
            return s
        return f"[hmm] {say(theirs['san']).capitalize()}... correct, rien à dire. On continue notre plan !"
    parts = []
    if mine and mine["key"] in bad:
        parts.append(f"[hmm] Petite imprécision avec {say(mine['san'])}, ça arrive ! " + _why_text(mine))
        if mine.get("best"):
            parts.append(f"Il fallait plutôt jouer {say(mine['best'])}.")
        if mine.get("pv_after"):
            parts.append(f"[sigh] Maintenant, {opp} peut jouer {say(mine['pv_after'][0])} pour en profiter.")
    elif mine and mine["key"] in ("best", "brilliant", "excellent"):
        parts.append(f"[excited] Excellent, {say(mine['san'])}, c'est EXACTEMENT ce que je voulais voir !")
    if theirs and theirs["key"] in bad and theirs.get("pv_after"):
        parts.append(f"[laugh] Regarde : {opp} affaiblit sa position avec {say(theirs['san'])}. " + _why_text(theirs) + f"Tu peux le punir avec {say(theirs['pv_after'][0])} !")
    elif theirs:
        parts.append(f"{opp} joue {say(theirs['san'])} : surveille ce qu'il menace.")
    if p.get("my_hanging"):
        parts.append("Attention : " + ", ".join(p["my_hanging"]) + " est menacé !")
    if not parts:
        parts.append("[hmm] Position tranquille : développe tes pièces et pense à la sécurité de ton roi !")
    return " ".join(parts)


# ----------------------------------------------------------------------------- génération
def write(cfg, task, payload, lang="fr"):
    """Retourne (texte_parlé_avec_tags, texte_affiché, llm_ok). Jamais d'exception : LLM indisponible -> texte de secours pédagogique (llm_ok = False)."""
    import nasko_llm
    en = lang == "en"
    system = (STYLE_EN if en else STYLE_FR) + (TASKS_EN if en else TASKS_FR).get(task, "") + "\n\n" + (nasko_persona._TAG_RULES_EN if en else nasko_persona._TAG_RULES_FR)
    if nasko_persona.guest_on():                                     # écoute Discord : ETO s'adresse à l'invité distant qui joue contre lui
        system += nasko_persona.guest_directive(lang, "eto")
    if payload.get("situation"):                                     # coup brillant : mode « hype absolue »
        system += HYPE_EN if en else HYPE_FR
    ok = True
    try:
        user = describe(payload, lang)
        if payload.get("situation"):                                 # les modèles à raisonnement pèsent surtout le message utilisateur : la consigne y est répétée
            user += ("\n\nANSWER IN ABSOLUTE HYPE: shouting, CAPS, [shouts] first, justify the beauty of the sacrifice with the data above." if en else
                     "\n\nRÉPONDS EN HYPE ABSOLUE : cris, majuscules, [shouts] en ouverture, tu justifies la beauté du sacrifice avec les données ci-dessus.")
        text = nasko_llm.complete(cfg, system, user, 520)
        spoken = nasko_persona.ensure_tags(text)
        if len(spoken) > 420:                                       # coût de synthèse et rythme de stream : on coupe à la dernière phrase entière
            cut = spoken[:420]
            spoken = cut[:max(cut.rfind("."), cut.rfind("!"), cut.rfind("?")) + 1] or cut
    except Exception as e:                                          # noqa: BLE001
        ok = False
        log.warning("Coach sans LLM (%s) : texte de secours", e)
        spoken = nasko_persona.ensure_tags(fallback(task if task in TASKS_FR else "coach", payload))
    spoken = nasko_persona.spoken_text(spoken, lang, space=False)
    spoken = re.sub(r"(^|[.!?…]\s+|\]\s*)([a-zà-ÿ])", lambda m: m.group(1) + m.group(2).upper(), spoken)   # majuscule en début de phrase                # le LLM a pu laisser un « Fe3 » : tout est converti en mots avant affichage ET synthèse
    return spoken, nasko_persona.clean(spoken), ok


# ----------------------------------------------------------------------------- MODE APPRENTISSAGE : ETO enseigne une ouverture (arbre de variantes PGN)
STUDY_VERSION = "2"
STUDY_FR = (
    nasko_persona._STREAMER_FR +
    "Tu ENSEIGNES une ouverture d'échecs à un élève de 1200-1300 Elo : tu joues toi-même la démonstration sur l'échiquier (coups, flèches, retours en arrière) et tu expliques en direct. "
    "RÈGLES STRICTES : n'utilise QUE les coups, les lignes et les NOTES DE RÉFÉRENCE fournis (jamais de variante ni de théorie inventée) ; dis chaque coup EXACTEMENT sous la forme en toutes lettres fournie "
    "(« cavalier en f3 », « pion prend en d5 »), JAMAIS en notation (pas de « Cf3 », « exd5 ») ; les crochets [ ] servent UNIQUEMENT aux audio tags ; parle à l'oral, 2 à 3 phrases COURTES "
    "(35 mots maximum, 2 phrases : l'audio doit démarrer vite), commence par un audio tag ou une interjection ; explique le POURQUOI (centre, développement, sécurité du roi, case faible, pion attaqué, plan) avec tes mots. "
)
STUDY_EN = (
    nasko_persona._STREAMER_EN +
    "You TEACH a chess opening to a 1200-1300 Elo student: you play the whole demonstration yourself on the board (moves, arrows, rewinds) and explain live. "
    "STRICT RULES: use ONLY the moves, lines and REFERENCE NOTES provided (never invent a line or theory); say every move EXACTLY in the spelled-out form provided (\"knight to f3\"), NEVER in notation; "
    "brackets [ ] are ONLY for audio tags; speak aloud, 2 SHORT sentences (35 words max, audio must start fast), start with an audio tag or an interjection; explain the WHY (center, development, king safety, weak square, attacked pawn, plan) in your words. "
)
STUDY_TASKS_FR = {
    "intro": "Lance la leçon : présente l'ouverture (son nom, le camp que l'élève jouera, l'idée générale en une phrase) et annonce que tu prends les commandes du plateau pour la démonstration. Ne cite AUCUN coup. ",
    "move": "Tu viens de jouer les coups indiqués sur l'échiquier. Explique l'IDÉE de ces coups (utilise les notes de référence) : pourquoi on les joue et ce qu'ils préparent. ",
    "announce": "Annonce la VARIANTE que tu vas montrer maintenant : dis le coup de l'adversaire concerné, ce que ce choix signifie (note de référence) et que tu vas le jouer sur l'échiquier. "
                "Si « RETOUR EN ARRIÈRE » est indiqué, commence par dire que le plateau revient en arrière. ",
    "resume": "Les variantes secondaires sont montrées : dis qu'on revient à la ligne PRINCIPALE et ce qui la caractérise (notes de référence). ",
    "end": "La démonstration est TERMINÉE : fais un mini-bilan de l'idée clé de l'ouverture en une phrase, puis rends la main à l'élève. Ne refais PAS la liste des coups : une seule phrase d'idée clé. Tu DOIS finir par la phrase : « À toi de jouer, montre-moi si t'as compris la théorie {theory} ! » ",
    "ok": "L'élève vient de jouer le BON coup de la théorie. Félicite-le en une phrase et dis POURQUOI c'est le bon coup (notes de référence), puis annonce la réponse de l'adversaire si elle est indiquée. ",
    "off": "L'élève a joué un coup HORS théorie. Dédramatise, dis ce que ce coup change, puis donne le coup attendu par la théorie (en toutes lettres) et POURQUOI (notes de référence). Invite-le à réessayer. ",
    "done": "L'élève a terminé la ligne : félicite-le avec énergie, dis combien d'erreurs il a faites et propose de relancer une autre ligne. ",
}
STUDY_TASKS_EN = {
    "intro": "Open the lesson: introduce the opening (its name, the side the student will play, the general idea in one sentence) and announce you take control of the board for the demonstration. Mention NO move. ",
    "move": "You just played the moves shown on the board. Explain the IDEA of these moves (use the reference notes): why we play them and what they prepare. ",
    "announce": "Announce the VARIATION you are about to show: say the opponent's move concerned, what that choice means (reference note) and that you will play it on the board. If \"REWIND\" is indicated, start by saying the board goes back. ",
    "resume": "The side variations have been shown: say we return to the MAIN line and what characterises it (reference notes). ",
    "end": "The demonstration is OVER: one-sentence recap of the key idea, then hand the board back. Do NOT list the moves again: one key-idea sentence. You MUST end with the sentence: \"Your turn, show me you understood the theory {theory}!\" ",
    "ok": "The student just played the BOOK move. Congratulate in one sentence and say WHY it is right (reference notes), then announce the opponent's reply if given. ",
    "off": "The student played an OFF-BOOK move. Reassure, say what it changes, then give the move expected by theory (in words) and WHY (reference notes). Invite a retry. ",
    "done": "The student finished the line: congratulate with energy, say how many mistakes, and offer another line. ",
}


def describe_study(c, lang="fr"):
    """Contexte d'une réplique d'apprentissage : tout est vérifié côté Python (coups, notes du PGN) ; le LLM le met en mots."""
    en = lang == "en"
    L = [(f"OPENING: {c['opening']} (repertoire for {'White' if c['color'] == 'white' else 'Black'}); the student plays {c['me_name']}." if en
          else f"OUVERTURE : {c['opening']} (répertoire des {'Blancs' if c['color'] == 'white' else 'Noirs'}) ; l'élève joue les {c['me_name']}.")]
    if c.get("variation"):
        L.append(("Current variation: " if en else "Variante en cours : ") + c["variation"])
    if c.get("line"):
        L.append(("Moves from the start: " if en else "Coups depuis le début : ") + c["line"])
    if c.get("played"):
        L.append(("Moves just played: " if en else "Coups qui viennent d'être joués : ") + c["played"])
    if c.get("next"):
        L.append(("Move to announce (opponent): " if en else "Coup à annoncer (adversaire) : ") + c["next"])
    if c.get("back"):
        L.append("REWIND: the board just went back to the branching point." if en else "RETOUR EN ARRIÈRE : le plateau vient de revenir au point de bifurcation.")
    if c.get("student"):
        L.append(("Student's move: " if en else "Coup de l'élève : ") + c["student"])
    if c.get("expected"):
        L.append(("Move expected by theory: " if en else "Coup attendu par la théorie : ") + c["expected"])
    if c.get("reply"):
        L.append(("Opponent's reply: " if en else "Réponse de l'adversaire : ") + c["reply"])
    if c.get("errors") is not None and c.get("kind") == "done":
        L.append(f"Mistakes made: {c['errors']}." if en else f"Erreurs commises : {c['errors']}.")
    if c.get("notes"):
        L.append(("REFERENCE NOTES (verified, explain in your words): " if en else "NOTES DE RÉFÉRENCE (vérifiées, à expliquer avec tes mots) : ") + " | ".join(c["notes"]))
    L.append("The simulated opponent plays like a typical 1200-1300 Elo player." if en else "L'adversaire simulé joue comme un joueur typique de 1200-1300 Elo.")
    return "\n".join(L)


def fallback_study(kind, c, lang="fr"):
    """Texte de secours (sans LLM) : mêmes données, même structure."""
    en = lang == "en"
    notes = " ".join(c.get("notes") or [])
    th = c.get("theory", "")
    if kind == "intro":
        return (f"[excited] Okay, let's go! Today: {c['opening']}. I take the board, watch closely! {notes}" if en
                else f"[excited] Ok, allez c'est parti ! Aujourd'hui : {c['opening']}. Je prends les commandes du plateau, regarde bien ! {notes}")
    if kind == "announce":
        if en:
            return ("[excited] Rewind! " if c.get("back") else "[hmm] ") + f"But if he plays {c.get('next', '')}... {notes}"
        return ("[excited] Retour en arrière ! " if c.get("back") else "[hmm] Et s'il joue ça ? ") + f"Du coup, s'il joue {c.get('next', '')}... {notes}"
    if kind == "resume":
        return "[excited] Alright, back to the main line!" if en else "[excited] Bon, on revient à la ligne principale !"
    if kind == "end":
        return (f"[excited] That's the whole idea! Your turn, show me you understood the theory {th}!" if en
                else f"[excited] Voilà toute l'idée ! À toi de jouer, montre-moi si t'as compris la théorie {th} !")
    if kind == "ok":
        return (f"[excited] Yes! {c.get('student', '')}, exactly the book move. {notes}" if en
                else f"[excited] Oui ! {c.get('student', '')}, c'est EXACTEMENT le coup de la théorie. {notes}")
    if kind == "off":
        return (f"[hmm] Not quite. Theory wants {c.get('expected', '')}. {notes} Try again!" if en
                else f"[hmm] Pas tout à fait. La théorie veut {c.get('expected', '')}. {notes} Réessaie !")
    if kind == "done":
        return (f"[excited] Line complete! Mistakes: {c.get('errors', 0)}. Ready for another one?" if en
                else f"[excited] Ligne terminée ! Erreurs : {c.get('errors', 0)}. On en lance une autre ?")
    return f"[excited] {c.get('played', '')}. {notes}"


def write_study(cfg, kind, ctx, lang="fr"):
    """Retourne (texte_parlé_avec_tags, texte_affiché, llm_ok). Jamais d'exception : sans LLM, texte de secours."""
    import nasko_llm
    en = lang == "en"
    ctx = dict(ctx, kind=kind)
    task = (STUDY_TASKS_EN if en else STUDY_TASKS_FR).get(kind, STUDY_TASKS_FR["move"]).replace("{theory}", ctx.get("theory", ""))
    system = (STUDY_EN if en else STUDY_FR) + task + "\n\n" + (nasko_persona._TAG_RULES_EN if en else nasko_persona._TAG_RULES_FR)
    ok = True
    try:
        text = nasko_llm.complete(cfg, system, describe_study(ctx, lang), 420)
        spoken = nasko_persona.ensure_tags(text)
        if len(spoken) > 300:
            cut = spoken[:300]
            spoken = cut[:max(cut.rfind("."), cut.rfind("!"), cut.rfind("?")) + 1] or cut
    except Exception as e:                                          # noqa: BLE001
        ok = False
        log.warning("Étude sans LLM (%s) : texte de secours", e)
        spoken = nasko_persona.ensure_tags(fallback_study(kind, ctx, lang))
    if kind == "end":                                               # passage de main : bilan d'UNE phrase (le LLM déroule parfois toute la ligne) + phrase contractuelle
        cut_at = min([i for i in (spoken.find("À toi de jouer"), spoken.find("Your turn")) if i >= 0] or [len(spoken)])
        recap = spoken[:cut_at].strip()
        m = re.search(r"[.!?…]", recap[20:])
        recap = recap[:20 + m.end()] if m else recap
        if len(recap) > 170:
            recap = nasko_persona.ensure_tags(fallback_study("end", ctx, lang)).split("À toi de jouer")[0].split("Your turn")[0].strip()
        spoken = recap.rstrip() + (f" Your turn, show me you understood the theory {ctx.get('theory', '')}!" if en
                                   else f" À toi de jouer, montre-moi si t'as compris la théorie {ctx.get('theory', '')} !")
    spoken = nasko_persona.spoken_text(spoken, lang, space=False)
    spoken = re.sub(r"(^|[.!?…]\s+|\]\s*)([a-zà-ÿ])", lambda m: m.group(1) + m.group(2).upper(), spoken)
    return spoken, nasko_persona.clean(spoken), ok
