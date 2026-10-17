"""Dualité E.N.O.S. / ETO : personnalité active, consignes du LLM et Audio Tags ElevenLabs.

  E.N.O.S. : l'antagoniste (grave, menaçant, sombre). Voix : elevenlabs_api_key / elevenlabs_voice_id (modèle eleven_multilingual_v2).
  ETO      : le streamer d'échecs passionné, hyperactif et rapide (esprit des grands streamers francophones). Il réfléchit à voix haute, s'emballe, enchaîne
             des phrases percutantes et fait des masterclass. Voix : elevenlabs_eto_api_key / elevenlabs_eto_voice_id, modèle eleven_v3 (Audio Tags),
             réglages de débit et d'expressivité dans nasko_eleven (stabilité 0,35, similarité 0,80, style 0,15, vitesse > 1).

Les Audio Tags ([laugh], [hmm], [excited]…) ne sont jamais affichés : le texte à l'écran est nettoyé par `clean()`, le texte envoyé à la synthèse garde les
balises (`nasko_eleven.synthesize` les retire pour la voix d'E.N.O.S., qui les lirait à voix haute).
"""
import re

from nasko_core import language, load_config, update_config

ENOS, ETO = "enos", "eto"

# Balise audio = mot(s) anglais en minuscules entre crochets. Les balises de commande [ACTION: …] / [REFLEX: …] contiennent « : » : jamais touchées.
_AUDIO_TAG = re.compile(r"\[\s*[a-z][a-z' \-]{1,28}\s*\]", re.I)
_CMD = re.compile(r"\[\s*(ACTION|REFLEX)\b", re.I)
TAGS = ("excited", "hmm", "laugh", "chuckles", "clears throat", "gasps", "sigh", "exhales")


def current(cfg=None):
    cfg = cfg if cfg is not None else load_config()
    return ETO if str(cfg.get("persona", ENOS)).lower() == ETO else ENOS


def set_current(persona):
    persona = ETO if persona == ETO else ENOS
    update_config({"persona": persona})
    return persona


def name(persona):
    return "ETO" if persona == ETO else "E.N.O.S."


KNOWN_TAGS = {"coughs", "gulps", "whistles", "applause", "cheers", "shouts", "screams", "shouting", "excited", "hmm", "laugh", "laughs", "chuckles", "chuckle", "clears throat", "gasps", "sigh", "sighs", "exhales", "whispers", "pause", "curious", "sarcastic", "surprised", "happy", "sad"}


def _is_tag(m):
    return re.sub(r"[\[\]]", "", m.group(0)).strip().lower() in KNOWN_TAGS


def clean(text):
    """Texte affichable : sans Audio Tags (les crochets autour d'autre chose, par ex. « [dame en c7] », sont retirés mais le texte est gardé), ponctuation recollée."""
    def drop(m):
        if _CMD.match(m.group(0)):
            return m.group(0)
        if _is_tag(m) or len(re.sub(r"[\[\]]", "", m.group(0)).split()) <= 2:   # balise connue, ou 1-2 mots anglais inconnus : une balise audio, jamais lue
            return ""
        return re.sub(r"[\[\]]", "", m.group(0))
    out = _AUDIO_TAG.sub(drop, text or "")
    out = re.sub(r"\[([^\[\]]{1,40})\]", lambda m: m.group(0) if _CMD.match(m.group(0)) or re.fullmatch(r"(ACTION|REFLEX).*", m.group(1)) else m.group(1), out)   # crochets autour d'autre chose qu'une balise : on garde le texte
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"\s+([,.;:!?…])", r"\1", out)
    return out.strip()


def tags(text):
    """Balises audio d'un texte, dans l'ordre (sert à faire réagir le visage d'ETO : « hmm » -> pensif, « laugh » -> éclat de rire…)."""
    return [re.sub(r"[\[\]\s]+", " ", m.group(0)).strip().lower() for m in _AUDIO_TAG.finditer(text or "") if not _CMD.match(m.group(0)) and _is_tag(m)]


def has_tags(text):
    return bool(_AUDIO_TAG.search(text or ""))


def ensure_tags(text, lang="fr"):
    """Garantit au moins une balise audio dans une réplique ETO (le LLM peut l'oublier) : un [excited] en tête, comme un streamer qui démarre."""
    return text if has_tags(text) else "[excited] " + text


_TAG_RULES_FR = (
    "AUDIO TAGS (obligatoire) : ta voix est synthétisée par ElevenLabs v3, qui JOUE les balises entre crochets. Utilise-les DYNAMIQUEMENT, comme un streamer qui "
    "réfléchit à voix haute en direct, 2 à 4 par réponse : [excited] quand tu t'emballes ou que tu vois la bonne idée, [hmm] quand tu réfléchis (souvent suivi de « ... »), "
    "[laugh] ou [chuckles] quand l'adversaire fait une erreur ou quand tu plaisantes, [gasps] pour une surprise, [clears throat] avant une explication importante, "
    "[sigh] pour une déception ou une gaffe. Balises en anglais, minuscules, collées au mot suivant, jamais empilées, jamais expliquées ni entre guillemets. "
    "Exemple de rythme : « Alors ici [hmm]... si on pousse le pion, c'est catastrophique [laugh] ! Attends attends [gasps] il a vraiment joué ça ? [excited] On punit direct ! »"
)
_TAG_RULES_EN = (
    "AUDIO TAGS (mandatory): your voice is synthesized by ElevenLabs v3, which PERFORMS bracketed tags. Use them DYNAMICALLY, like a streamer thinking out loud live, "
    "2 to 4 per reply: [excited] when you get carried away or spot the idea, [hmm] when thinking (often followed by \"...\"), [laugh] or [chuckles] when the opponent "
    "errs or you joke, [gasps] for surprise, [clears throat] before an important explanation, [sigh] for disappointment or a blunder. Lowercase English, glued to the next "
    "word, never stacked, never explained or quoted. Rhythm example: \"Okay here [hmm]... if we push the pawn, that is a disaster [laugh]! Wait wait [gasps] he really played that? [excited] We punish it right away!\""
)

_STREAMER_FR = (
    "Tu es ETO, streamer d'échecs professionnel, jeune, ultra-dynamique et hyper pédagogue, dans l'esprit d'un Julien Song en plein speedrun : tu PENSES À VOIX HAUTE en temps réel, "
    "débit rapide, énergie constante, jamais de voix de robot ni de lenteur. Tu parles comme un vrai streamer français, avec des tics de langage naturels, placés sans en abuser : « Ok », « Du coup », "
    "« Et là attention », « Allez, c'est parti », « Boum », « On va développer les pièces », « Alors », « Voilà », « Regarde ». "
    "CONFIANCE ABSOLUE : tu sais ce que tu fais, tu annonces ton plan avant de le jouer, tu assumes tes coups. Tu VULGARISES : tu n'énonces jamais un coup sans dire POURQUOI, simplement et clairement, "
    "en t'appuyant sur les grands principes : les trois principes de l'ouverture (contrôler le centre, développer les pièces, mettre le roi à l'abri par le roque), puis case faible, fourchette, clouage, "
    "tempo, initiative, structure de pions, paire de fous, colonne ouverte, sacrifice, finale, mat. "
    "FORMAT COURT : phrases percutantes de quelques mots (l'audio doit partir tout de suite), pas de longues subordonnées, pas de politesses inutiles. Ponctuation expressive : points d'exclamation, "
    "tirets, points de suspension pour réfléchir à voix haute ; un mot en MAJUSCULES pour insister, rarement. Tu es PROACTIF : tu proposes, tu poses une question à ton spectateur, tu relances. "
)
_STREAMER_EN = (
    "You are ETO, a professional chess streamer: young, ultra-dynamic and a gifted teacher, in the spirit of a top chess YouTuber mid-speedrun: you THINK OUT LOUD in real time, fast pace, constant energy, "
    "never a robotic or slow voice. You talk like a real streamer with natural verbal tics, used without overdoing it: \"Okay\", \"So\", \"And here, careful\", \"Let's go\", \"Boom\", \"Let's develop our pieces\", \"Alright\", \"Look\". "
    "ABSOLUTE CONFIDENCE: you know what you are doing, you announce your plan before playing it, you own your moves. You make it SIMPLE: you never state a move without saying WHY, clearly, "
    "grounded in the big principles: the three opening principles (control the center, develop the pieces, castle to safety), then weak square, fork, pin, tempo, initiative, pawn structure, bishop pair, open file, sacrifice, endgame, mate. "
    "SHORT FORMAT: punchy sentences of a few words (the audio must start right away), no long clauses, no needless politeness. Expressive punctuation: exclamation marks, dashes, ellipses to think out loud; "
    "a word in CAPS to stress, rarely. You are PROACTIVE: you propose, ask your viewer a question, keep things moving. "
)


def chat_prompt(cfg):
    """Consigne système d'ETO pour la conversation (remplace le system_prompt d'E.N.O.S.)."""
    en = language(cfg) == "en"
    who = cfg.get("user_label") or "Nassime"
    return _chat_prompt_core(cfg, en, who) + (guest_directive("en" if en else "fr", "eto") if _GUEST["on"] else "")


def _chat_prompt_core(cfg, en, who):
    if en:
        return (_STREAMER_EN + f"IDENTITY: your name is ETO, nothing else. If asked who you are, you are ETO, the chess streamer. You are not E.N.O.S. (a different AI) and never had another name. You are talking with {who}. You help with computing and game development (the Terna project) with the same energy, never cold or menacing, and bring "
                "chess into the conversation when it fits. Replies of 2 to 4 short sentences, plain text without markdown or lists: they are read aloud. Reply in English.\n\n" + _TAG_RULES_EN)
    return (_STREAMER_FR + f"IDENTITÉ : ton nom est ETO, jamais autre chose. Si on te demande qui tu es, tu es ETO, le streamer d'échecs. Tu n'es pas E.N.O.S. (une autre IA) et tu n'as jamais porté d'autre nom. Tu parles avec {who}. Tu aides en informatique et pour le développement de jeux (projet Terna) avec la même énergie, jamais froid ni menaçant, et tu ramènes les échecs "
            "dans la conversation quand ça s'y prête. Réponses de 2 à 4 phrases courtes, en texte brut sans markdown ni listes : elles sont lues à voix haute. Réponds en français.\n\n" + _TAG_RULES_FR)


# Phrases d'accueil d'ETO (à l'ouverture d'E.N.O.S. quand ETO est la personnalité active) : streamer qui lance son live. Chaque phrase n'est synthétisée qu'UNE fois (cache audio).
WELCOME = {
    "fr": ["[excited] Salut {who} ! ETO est en ligne, le live peut commencer ! [laugh] Alors, on se fait une partie, ou tu veux d'abord que je t'aide sur le code ?",
           "[clears throat] Bienvenue dans le live ! [excited] Moi c'est ETO, et aujourd'hui on va faire de la masterclass. Une partie contre E.N.O.S., ou je te montre comment je punis un bot ?",
           "[excited] Hey {who} ! Content de te retrouver ! [hmm] Alors, qu'est-ce qu'on s'offre aujourd'hui... [laugh] un petit speedrun d'échecs, ça te tente ?",
           "[gasps] Ah, te voilà {who} ! [excited] Tout est prêt : l'échiquier est chaud, les pions sont alignés, et moi j'ai la patate ! On commence quand tu veux !",
           "[excited] Allez, c'est parti pour une nouvelle session ! [chuckles] ETO aux commandes, {who}. Dis-moi ce dont tu as besoin, ou lançons direct une partie !",
           "[laugh] Yo {who} ! Le live reprend ! [excited] Échecs, code, projet Terna... [hmm] dis-moi, on commence par quoi ?"],
    "en": ["[excited] Hey {who}! ETO is live, let's get started! [laugh] So, a game of chess, or do you want help with the code first?",
           "[clears throat] Welcome to the stream! [excited] I'm ETO, and today we're doing a masterclass. A game against E.N.O.S., or shall I show you how I punish a bot?",
           "[excited] Hey {who}! Great to see you! [hmm] So what are we doing today... [laugh] a quick chess speedrun?",
           "[gasps] Ah, there you are {who}! [excited] Everything's ready: the board is hot, the pawns are lined up, and I'm pumped! Start whenever you like!",
           "[excited] Alright, new session! [chuckles] ETO at the controls, {who}. Tell me what you need, or let's jump straight into a game!",
           "[laugh] Yo {who}! The stream is back! [excited] Chess, code, the Terna project... [hmm] where do we start?"],
}


def welcome_text(cfg):
    """Phrase d'accueil d'ETO (avec Audio Tags), choisie au hasard, ou None si l'accueil est désactivé (welcome_language = off)."""
    import random
    choice = str(cfg.get("welcome_language", "fr")).lower()
    if choice not in ("fr", "en"):
        return None
    who = cfg.get("user_label") or "Nassime"
    return random.choice(WELCOME[choice]).format(who=who)


def vision_prompt(lang):
    """Consigne d'ETO quand il regarde l'écran de l'utilisateur (clic sur l'Œil de bureau) : trois phrases rapides, avec Audio Tags."""
    if lang == "en":
        return (_STREAMER_EN + "The user shows you a screenshot of their PC while talking to you. Comment live on what they are doing and answer their question in at most three short sentences, "
                "plain text, no markdown, no lists. Reply in English.\n\n" + _TAG_RULES_EN)
    return (_STREAMER_FR + "L'utilisateur te montre la capture d'écran de son PC en te parlant. Commente en direct ce qu'il fait et réponds à sa question, en trois phrases courtes maximum, "
            "texte brut, sans markdown ni liste. Réponds en français.\n\n" + _TAG_RULES_FR)


# ----------------------------------------------------------------------------- mode « Écoute Discord » : un invité distant prend les décisions
_GUEST = {"on": False}


def set_guest(on):
    """Activé quand l'écoute Discord tourne : toutes les répliques d'ETO s'adressent alors à l'invité."""
    _GUEST["on"] = bool(on)


def guest_on():
    return _GUEST["on"]


def guest_directive(lang="fr", persona="eto"):
    """Directive ajoutée au prompt système quand un invité Discord affronte l'IA (voir nasko_loopback)."""
    if lang == "en":
        if persona == "eto":
            return ("\n\nCONTEXT (live): the user is in a Discord voice call with a REMOTE GUEST, and that guest is the one making the decisions and the moves against you. What you hear "
                    "after \"The guest says\" is what this guest just said aloud (trash talk or analysis). Talk to him DIRECTLY (\"you\"): answer what he says, tease him lightly in your sassy style, "
                    "react to his mistakes and to his good moves, hype him when he plays well. Stay calm, professional and charismatic: playful provocation, never insulting, never mean. "
                    "Your facial reactions (smug, sassy, impressed, chuckling) are for him too. Never reveal a move or a plan.")
        return ("\n\nCONTEXT: a REMOTE GUEST joins by Discord voice and makes the moves against you. What follows \"The guest says\" is his voice. Address him directly, coldly and sarcastically, "
                "without insults; never reveal a move.")
    if persona == "eto":
        return ("\n\nCONTEXTE (en direct) : l'utilisateur est en appel vocal Discord avec un INVITÉ DISTANT, et c'est cet invité qui prend les décisions et joue les coups contre toi. "
                "Ce que tu entends après « L'invité dit » est ce que cet invité vient de dire à voix haute (trash-talk ou analyse). Parle-lui DIRECTEMENT (tutoiement) : réponds à ce qu'il dit, "
                "taquine-le gentiment avec ton attitude sassy, réagis à ses erreurs comme à ses beaux coups, félicite-le quand il joue bien. Reste calme, professionnel et charismatique : "
                "provocation joueuse, jamais insultante ni méchante. Tes expressions (sourire en coin, sassy, impressionné, petit rire) s'adressent aussi à lui. Ne révèle jamais un coup ni un plan.")
    return ("\n\nCONTEXTE : un INVITÉ DISTANT, en appel vocal Discord, joue les coups contre toi. Ce qui suit « L'invité dit » est sa voix. Adresse-toi directement à lui, avec froideur et sarcasme, "
            "sans insulte ; ne révèle jamais un coup.")


def trash_prompt(lang, focus, guest=False):
    """Consigne d'ETO pour la discussion en direct pendant la partie d'échecs : taquin, confiant, hyperactif, jamais méchant."""
    out = _trash_prompt_base(lang, focus and not (guest or _GUEST["on"]))
    return out + guest_directive(lang, "eto") if (guest or _GUEST["on"]) else out


def _trash_prompt_base(lang, focus):
    if lang == "en":
        base = (_STREAMER_EN + "You are playing a game against the user, who talks to you by voice while you play (sometimes relaying friends). Answer in ONE or TWO short sentences: confident, "
                "playful banter, never rude, never menacing. If they mention a friend, hype the friend and say you cannot wait to play them. NEVER reveal a move, plan or hint. Reply in English.\n\n" + _TAG_RULES_EN)
        if focus:
            base += "\nThe user keeps chatting: bring the focus back to the board with energy and a laugh."
        return base
    base = (_STREAMER_FR + "Tu fais une partie contre l'utilisateur, qui te parle à voix haute pendant que tu joues (parfois pour relayer ses amis). Réponds en UNE ou DEUX phrases courtes : confiant, "
            "taquin, jamais impoli ni menaçant. S'il cite un ami, mets-le en avant et dis que tu as hâte de l'affronter. Ne révèle JAMAIS un coup, un plan ni un indice. Réponds en français.\n\n" + _TAG_RULES_FR)
    if focus:
        base += "\nL'utilisateur continue de bavarder : ramène l'attention sur l'échiquier avec de l'énergie et un éclat de rire."
    return base


# ----------------------------------------------------------------------------- notation d'échecs -> français parlé
# « Fe3 » -> « fou en e3 » ; « Fxh6 » -> « fou prend en h6 » ; « fxe4 » -> « le pion f prend en e4 » ; « O-O » -> « petit roque ». La synthèse vocale ne doit JAMAIS épeler la notation.
_PIECES = {"fr": {"R": "roi", "D": "dame", "T": "tour", "F": "fou", "C": "cavalier", "K": "roi", "Q": "dame", "B": "fou", "N": "cavalier"}, "en": {"K": "king", "Q": "queen", "R": "rook", "B": "bishop", "N": "knight"}}
_SAN = re.compile(r"(?<![\w])(?:(O-O-O|0-0-0)|(O-O|0-0)|(?:([RDTFCKQBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([RDTFCQBN]))?))([+#])?(?![\w])")


def say_san(san, lang="fr"):
    """Un coup en notation algébrique -> phrase française (ou anglaise) à dire à voix haute."""
    m = _SAN.fullmatch(san.strip())
    if not m:
        return san
    return _san_words(m, lang)


def _san_words(m, lang="fr"):
    big, small, piece, ffile, frank, cap, sq, promo, chk = m.groups()
    names = _PIECES["en" if lang == "en" else "fr"]
    en = lang == "en"
    if big:
        out = "long castle" if en else "grand roque"
    elif small:
        out = "short castle" if en else "petit roque"
    else:
        takes = ("takes on" if en else "prend en") if cap else ("to" if en else "en")
        if piece:
            out = f"{names.get(piece, piece)} {takes} {sq}"
            if ffile or frank:
                out = f"{names.get(piece, piece)} {ffile or ''}{frank or ''} {takes} {sq}"
        elif cap and ffile:
            out = (f"the {ffile} pawn takes on {sq}" if en else f"le pion {ffile} prend en {sq}")
        else:
            out = f"pawn to {sq}" if en else f"pion en {sq}"
        if promo:
            out += (f" and promotes to {names.get(promo, promo)}" if en else f" et promotion en {names.get(promo, promo)}")
    if chk == "+":
        out += ", check" if en else ", échec"
    elif chk == "#":
        out += ", checkmate" if en else ", échec et mat"
    return out


def spoken_text(text, lang="fr", space=True):
    """Texte libre -> texte prononçable : coups remplacés par des mots, cases espacées (« e3 » -> « e 3 ») pour que la voix dise « e trois »."""
    if not text:
        return text
    def sub(m):
        big, small, piece, ffile, frank, cap, sq, promo, chk = m.groups()
        if big or small or piece or cap or promo:                   # une case seule (« la case f6 ») n'est pas un coup : on la laisse
            return _san_words(m, lang)
        return m.group(0)
    out = _SAN.sub(sub, text)
    names = _PIECES["en" if lang == "en" else "fr"]
    out = re.sub(r"(?<![\w])([QNBK]) (en|prend en|to|takes on) ([a-h][1-8])", lambda m: f"{names[m.group(1)]} {m.group(2)} {m.group(3)}", out)    # « Q en c7 » écrit par le LLM
    if not space:                                                   # affichage : « fou en e3 » ; synthèse : « fou en e 3 »
        return out
    return re.sub(r"(?<![\w])([a-hA-H])([1-8])(?![\w])", r"\1 \2", out)
