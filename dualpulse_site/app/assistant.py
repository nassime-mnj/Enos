"""Assistant Support : recherche dans la base de connaissances PUBLIQUE (content.KB). Déterministe, sans service externe, sans fuite possible
d'information interne (il ne connaît que ce qui est écrit dans content.py). Remplaçable plus tard par un LLM : même interface answer()."""
import re
import unicodedata

import content

_STOP = set("the a an is are was were be to of in on for and or it its this that i you we do does can will my your our what which with at by from as there any have has am so if "
            "please just".split())


def _norm(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.replace("e.n.o.s", "enos")


def _tokens(s):
    return [t for t in re.findall(r"[a-z0-9]+", _norm(s)) if t not in _STOP and len(t) > 1]


def _score(entry, toks, text):
    score = 0.0
    for k in entry["k"]:
        kn = _norm(k)
        if " " in kn or "." in kn:
            score += 2.0 if kn.replace(".", "") in text.replace(".", "") else 0
        elif kn in toks:
            score += 1.5
        elif any(len(t) >= 4 and len(kn) >= 4 and (kn.startswith(t) or t.startswith(kn)) for t in toks):
            score += 1.0                                        # pluriels / conjugaisons proches (release ~ released)
    return score


def answer(message):
    """-> {reply, matched, suggestions}. Jamais d'exception, jamais de contenu hors base."""
    msg = (message or "").strip()[:500]
    email = content.STUDIO["contact_email"]
    toks = _tokens(msg)
    text = _norm(msg)
    best, best_s = None, 0.0
    for e in content.KB:
        s = _score(e, toks, text)
        if s > best_s:
            best, best_s = e, s
    if best and best_s >= 1.4:
        return {"reply": best["a"].format(email=email), "matched": best["id"], "suggestions": []}
    topics = "the studio, the game, the release date, playtests, platforms, contact"
    return {"reply": content.FALLBACK.format(topics=topics, email=email), "matched": None, "suggestions": content.SUGGESTIONS}
