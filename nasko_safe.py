"""FILTRE « SANS RELIGION » : tout ce que disent E.N.O.S. et ETO (chat, échecs, Titans, boss, coach, vision) passe par `no_religion()`.

Deux protections complémentaires :
  1. une consigne ajoutée aux prompts (RULE_FR / RULE_EN) : le modèle ne doit faire AUCUNE allusion religieuse (même en plaisanterie, en insulte ou en expression courante) ;
  2. ce filtre sur la réponse : les expressions courantes sont remplacées par un équivalent neutre (« mon Dieu » -> « oh là là », « dieu des échecs » -> « maître des échecs »),
     puis toute phrase qui contient encore un terme religieux est SUPPRIMÉE. Si rien ne reste, la fonction renvoie « » (l'appelant utilise alors sa réplique de secours).
Les termes d'échecs (fou / bishop, sacrifice, roi, dame…) ne sont pas concernés.
"""
import re

RULE_FR = ("INTERDIT ABSOLU : aucune allusion à une religion, à Dieu ou aux dieux, au divin, au sacré, au paradis ou à l'enfer, aux anges, aux démons, au diable, aux prières, "
           "aux miracles ou à une figure ou un lieu religieux — ni sérieusement, ni en plaisanterie, ni en insulte, ni dans une expression courante (« mon Dieu », « divin », « sacré »…). "
           "Pour exprimer l'admiration ou la supériorité, parle de maître, de champion, de génie, d'exploit.")
RULE_EN = ("ABSOLUTELY FORBIDDEN: any reference to religion, God or gods, the divine, the sacred, heaven or hell, angels, demons, the devil, prayer, miracles or any religious figure or place — "
           "not seriously, not as a joke, not as an insult, not in a common expression (\"oh my god\", \"divine\", \"holy\"…). To express admiration or superiority, say master, champion, genius, feat.")

# 1) expressions courantes -> équivalent neutre (appliquées avant la suppression de phrases)
_IDIOMS_FR = [
    (r"\b(?:un|le|du|de|au|ce|cet)\s+dieu\s+(?:des|du|de la|de l['’])\s*[ée]checs", "le maître des échecs"),
    (r"\b(te|se|me|vous) (prend|prends|prenez|prennent)\s+pour (?:un |le |des )?(?:dieux?)\b", r"\1 \2 pour le maître absolu"),
    (r"\bdieux?\s+(?:des|du|de la|de l['’])\s*[ée]checs", "maître des échecs"),
    (r"\b(?:mon|bon|grand|pauvre|nom de|oh mon)\s+dieu\b", "oh là là"),
    (r"\bdieu merci\b", "heureusement"),
    (r"\bpar tous les saints\b", "par tous les échecs"),
    (r"\bd['’]enfer\b", "incroyable"),
    (r"\bdivin(?:e|es|s)?\b", "sublime"),
    (r"\bsacr[ée](?:e|es|s)?\b", "énorme"),
    (r"\bmiracle(?:s)?\b", "exploit"),
    (r"\bmiraculeu(?:x|se|ses)\b", "inespéré"),
]
_IDIOMS_EN = [
    (r"\b(?:(?:an? |the )?god(?:s)? of chess)\b", "the master of chess"),
    (r"\bthinks? (?:it|he|she|they) (?:is|are) (?:a |the )?god\b", "thinks it is the ultimate master"),
    (r"\b(?:oh )?my god\b|\boh god\b|\bgood god\b|\bomg\b|\boh my gosh\b", "wow"),
    (r"\bthank god\b|\bthank goodness\b", "luckily"),
    (r"\bfor god'?s sake\b", "come on"),
    (r"\bgod ?like\b", "unreal"),
    (r"\bgoddamn\w*|\bgod ?damn\w*", "ridiculous"),
    (r"\bdivine\b", "sublime"),
    (r"\bholy\s+(?:moly|cow|smoke|crap|cow)\b", "wow"),
    (r"\bmiracle(?:s)?\b", "feat"),
]

# 2) termes dont la présence fait supprimer la phrase
_BLOCK = re.compile(
    r"\b(?:dieux?|d[ée]esses?|divinit[ée]s?|divin\w*|god|gods|goddess\w*|godlike|"
    r"pri[eè]res?|prier|prie[sz]?|prions|priant|pri[eé]rai\w*|pray\w*|prayer\w*|seigneur\w*|lord|"
    r"paradis|enfers?|infernal\w*|heaven\w*|hell|damn\w*|damn[ée]\w*|purgatoire|purgatory|"
    r"d[ée]mons?|d[ée]moniaque\w*|demon\w*|diable\w*|diabolique\w*|devil\w*|satan\w*|lucifer|"
    r"anges?|ang[ée]lique\w*|angel\w*|saints?|saintes?|sainte?t[ée]\w*|holy|sacred|sacr[ée]\w*|"
    r"b[ée]ni\w*|b[ée]nir|b[ée]nit\w*|b[ée]n[ée]diction\w*|bless\w*|amen|"
    r"[ée]glises?|church\w*|cath[ée]drale\w*|chapelle\w*|synagogue\w*|mosqu[ée]e\w*|vatican|"
    r"bible\w*|biblique\w*|coran|quran|torah|talmud|"
    r"messie|messiah|proph[eè]t\w*|prophe\w*|gourou\w*|guru\w*|culte\w*|cults?|sectes?|"
    r"religi\w*|blasph\w*|sermon\w*|crois[ée]es?|crusade\w*|crucifi\w*|r[ée]surrection|ressuscit\w*|resurrect\w*|"
    r"apocalyp\w*|j[ée]sus|christ\w*|allah|mahomet|muhammad|bouddh\w*|buddh\w*|hindou\w*|hindu\w*|vishnu|shiva|"
    r"islam\w*|jud[ée]isme|christianisme|pape|pope|ritual\w*|rituel\w*|spirituel\w*|spiritual\w*)\b",
    re.I)

_SENT = re.compile(r"(?<=[.!?…])\s+")


def is_religious(text):
    return bool(_BLOCK.search(text or ""))


def no_religion(text, lang="fr"):
    """Texte débarrassé de toute allusion religieuse (voir l'en-tête). Retourne « » si plus rien ne subsiste."""
    if not text:
        return text
    out = text
    for rx, rep in (_IDIOMS_EN if lang == "en" else _IDIOMS_FR) + (_IDIOMS_FR if lang == "en" else _IDIOMS_EN):     # les deux langues : un modèle peut mélanger
        out = re.sub(rx, rep, out, flags=re.I)
    if not _BLOCK.search(out):
        return out
    kept = [s for s in _SENT.split(out) if s.strip() and not _BLOCK.search(s)]
    return " ".join(kept).strip()


def neutral(lang="fr"):
    return "Passons à autre chose : on joue." if lang != "en" else "Let's move on: back to the game."
